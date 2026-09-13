export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED']).optional(),
});

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; projectId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId, projectId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        tasks: {
          select: { id: true, title: true, status: true, assigneeId: true, dueAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return NextResponse.json(
      { project },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function PATCH(
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

    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );

    const { count } = await prisma.project.updateMany({
      where: { id: projectId, organizationId: orgId },
      data: updateData,
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true, name: true, description: true, status: true },
    });

    return NextResponse.json(
      { project },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
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

    const { count } = await prisma.project.deleteMany({
      where: { id: projectId, organizationId: orgId },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
