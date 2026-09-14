export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zCuid } from '@/lib/server/zod-helpers';
import { isOrgMember } from '@/lib/server/organizations/guards';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const UpdateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  assigneeId: zCuid.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; taskId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, taskId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { title, status, assigneeId, dueAt } = parsed.data;

    // A well-formed cuid is not proof of membership — without this the FK blows up as a 500.
    // `null` is an explicit un-assign and needs no check.
    if (assigneeId && !(await isOrgMember(prisma, orgId, assigneeId))) {
      return NextResponse.json(
        { error: 'ASSIGNEE_NOT_MEMBER', message: 'Assignee must be a member of this workspace' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { count } = await prisma.task.updateMany({
      where: { id: taskId, organizationId: orgId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
      },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'TASK_NOT_FOUND', message: 'Task not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
      select: { id: true, title: true, status: true, assigneeId: true, dueAt: true },
    });

    return NextResponse.json(
      { task },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; taskId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, taskId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const { count } = await prisma.task.deleteMany({
      where: { id: taskId, organizationId: orgId },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'TASK_NOT_FOUND', message: 'Task not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
