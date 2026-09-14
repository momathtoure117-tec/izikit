export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zEmail } from '@/lib/server/zod-helpers';
import { redis } from '@/lib/server/redis';
import { createEmailLimiter } from '@/lib/server/middleware/rate-limit-by-email';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const InviteBody = z.object({ email: zEmail });

// The invite endpoint distinguishes USER_NOT_FOUND (404) from ALREADY_MEMBER (409), which makes
// it an account-existence oracle for any authenticated caller (anyone can self-create a workspace
// and become its OWNER). That undercuts the enumeration-resistant signup contract, so the endpoint
// is rate limited on two axes:
//   - per invited email: caps repeated probing of one address;
//   - per calling user: caps a scan across many addresses, which the per-email bucket cannot see.
const inviteLimiter = createEmailLimiter(redis ? { redis } : {}, {
  bucket: 'org:invite',
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.ORG_INVITE_RATE_LIMIT_MAX ?? 5),
  code: 'TOO_MANY_INVITE_ATTEMPTS',
  message: 'Too many invite attempts. Try again later.',
});

const inviteScanLimiter = createEmailLimiter(redis ? { redis } : {}, {
  bucket: 'org:invite:caller',
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.ORG_INVITE_CALLER_RATE_LIMIT_MAX ?? 30),
  code: 'TOO_MANY_INVITE_ATTEMPTS',
  message: 'Too many invite attempts. Try again later.',
});

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const rows = await prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      select: { role: true, user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(
      {
        members: rows.map((r) => ({
          userId: r.user.id,
          email: r.user.email,
          name: r.user.name,
          role: r.role,
        })),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'ADMIN');
    if (auth instanceof NextResponse) return auth;

    const parsed = InviteBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const rateFail =
      (await inviteLimiter.check(req, parsed.data.email)) ??
      (await inviteScanLimiter.check(req, auth.user.sub));
    if (rateFail) return rateFail;

    const target = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'No account matches this email' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    try {
      const member = await prisma.organizationMember.create({
        data: { organizationId: orgId, userId: target.id, role: 'MEMBER' },
        select: { role: true },
      });
      return NextResponse.json(
        { member: { userId: target.id, email: target.email, role: member.role } },
        { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
      );
    } catch (err) {
      const isCollision =
        typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
      if (isCollision) {
        return NextResponse.json(
          { error: 'ALREADY_MEMBER', message: 'This user is already a member' },
          { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      throw err;
    }
  });
}
