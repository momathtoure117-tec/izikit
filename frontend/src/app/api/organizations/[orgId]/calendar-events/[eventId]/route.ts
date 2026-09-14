export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; eventId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, eventId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const event = await prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true, createdById: true },
    });

    if (!event || event.organizationId !== orgId) {
      return NextResponse.json(
        { error: 'EVENT_NOT_FOUND', message: 'Event not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const isCreator = event.createdById === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isCreator && !isAdminOrOwner) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN_NOT_OWNER',
          message: 'Only the creator or an admin can delete this event',
        },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await prisma.calendarEvent.delete({ where: { id: eventId } });

    return NextResponse.json(
      { success: true },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
