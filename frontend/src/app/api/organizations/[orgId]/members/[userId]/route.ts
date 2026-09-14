export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { countOwners } from '@/lib/server/organizations/guards';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const RoleBody = z.object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER']) });

type Discriminator =
  | { kind: 'NOT_FOUND' }
  | { kind: 'LAST_OWNER' }
  | { kind: 'OWNER_REQUIRED' }
  | { kind: 'OK'; role: string };

/**
 * Owner-tier transitions are OWNER-only.
 *
 * `requireOrgRole(orgId, 'ADMIN')` alone would let a plain ADMIN promote themselves to OWNER or
 * demote/remove a sitting OWNER, collapsing the documented MEMBER < ADMIN < OWNER hierarchy into
 * two tiers. So any operation that *touches* the OWNER tier — the target already is one, or the
 * request would make one — additionally requires the caller to be an OWNER.
 */
function ownerTierTouched(targetRole: string, requestedRole?: string): boolean {
  return targetRole === 'OWNER' || requestedRole === 'OWNER';
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; userId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, userId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'ADMIN');
    if (auth instanceof NextResponse) return auth;

    const parsed = RoleBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const result: Discriminator = await prisma.$transaction(async (tx) => {
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        select: { role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      if (ownerTierTouched(target.role, parsed.data.role) && auth.orgMember.role !== 'OWNER') {
        return { kind: 'OWNER_REQUIRED' as const };
      }

      if (target.role === 'OWNER' && parsed.data.role !== 'OWNER') {
        const owners = await countOwners(tx, orgId);
        if (owners <= 1) return { kind: 'LAST_OWNER' as const };
      }

      const updated = await tx.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: parsed.data.role },
        select: { role: true },
      });
      return { kind: 'OK' as const, role: updated.role };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'Member not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (result.kind === 'OWNER_REQUIRED') {
      return NextResponse.json(
        { error: 'ORG_ROLE_INSUFFICIENT', message: 'Insufficient organization role' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (result.kind === 'LAST_OWNER') {
      return NextResponse.json(
        { error: 'LAST_OWNER', message: 'Refuse to demote the last owner' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    return NextResponse.json(
      { member: { userId, role: result.role } },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; userId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, userId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'ADMIN');
    if (auth instanceof NextResponse) return auth;

    const result: Discriminator = await prisma.$transaction(async (tx) => {
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        select: { role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      if (ownerTierTouched(target.role) && auth.orgMember.role !== 'OWNER') {
        return { kind: 'OWNER_REQUIRED' as const };
      }

      if (target.role === 'OWNER') {
        const owners = await countOwners(tx, orgId);
        if (owners <= 1) return { kind: 'LAST_OWNER' as const };
      }

      await tx.organizationMember.delete({
        where: { organizationId_userId: { organizationId: orgId, userId } },
      });
      return { kind: 'OK' as const, role: target.role };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'Member not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (result.kind === 'OWNER_REQUIRED') {
      return NextResponse.json(
        { error: 'ORG_ROLE_INSUFFICIENT', message: 'Insufficient organization role' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (result.kind === 'LAST_OWNER') {
      return NextResponse.json(
        { error: 'LAST_OWNER', message: 'Refuse to remove the last owner' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
