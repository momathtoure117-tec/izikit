export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  name: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        createdById: auth.user.sub,
      },
      select: { id: true, name: true, description: true, status: true },
    });

    return NextResponse.json(
      { project },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const rows = await prisma.project.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        tasks: { select: { status: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const projects = rows.map(({ tasks, ...project }) => ({
      ...project,
      taskCounts: {
        total: tasks.length,
        done: tasks.filter((t) => t.status === 'DONE').length,
      },
    }));

    return NextResponse.json(
      { projects },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
