export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    // "me" is the only supported value in v1 — no arbitrary-user lookup.
    const assignee = req.nextUrl.searchParams.get('assignee');
    if (assignee !== 'me') {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'assignee must be "me"' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const tasks = await prisma.task.findMany({
      where: { organizationId: orgId, assigneeId: auth.user.sub },
      select: {
        id: true,
        title: true,
        status: true,
        dueAt: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json(
      { tasks },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
