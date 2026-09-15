export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zCuid } from '@/lib/server/zod-helpers';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(20000),
  projectId: zCuid.optional(),
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

    if (parsed.data.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: parsed.data.projectId, organizationId: orgId },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json(
          { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
    }

    const note = await prisma.note.create({
      data: {
        organizationId: orgId,
        projectId: parsed.data.projectId ?? null,
        authorId: auth.user.sub,
        title: parsed.data.title,
        body: parsed.data.body,
      },
      select: {
        id: true,
        title: true,
        body: true,
        authorId: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { note },
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

    const notes = await prisma.note.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        title: true,
        body: true,
        authorId: true,
        projectId: true,
        project: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(
      { notes },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
