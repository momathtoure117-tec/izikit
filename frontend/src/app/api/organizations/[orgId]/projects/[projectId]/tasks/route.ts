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

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  assigneeId: zCuid.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; projectId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, projectId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // A well-formed cuid is not proof of membership — without this the FK blows up as a 500.
    if (parsed.data.assigneeId && !(await isOrgMember(prisma, orgId, parsed.data.assigneeId))) {
      return NextResponse.json(
        { error: 'ASSIGNEE_NOT_MEMBER', message: 'Assignee must be a member of this workspace' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        projectId,
        title: parsed.data.title,
        assigneeId: parsed.data.assigneeId ?? null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        createdById: auth.user.sub,
      },
      select: { id: true, title: true, status: true, assigneeId: true, dueAt: true },
    });

    return NextResponse.json(
      { task },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
