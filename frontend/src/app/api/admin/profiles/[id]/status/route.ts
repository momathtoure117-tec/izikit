export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  status: z.enum(['PUBLISHED', 'SUSPENDED']),
  reason: z.string().min(1).max(500).optional(),
});

type Discriminator =
  | { kind: 'NOT_FOUND' }
  | { kind: 'OK'; profile: { id: string; status: string } };

export async function PATCH(
  req: NextRequest,
  ctxParams: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctxParams.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400 },
      );
    }

    const result: Discriminator = await prisma.$transaction(async (tx) => {
      const target = await tx.founderProfile.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      if (target.status === parsed.data.status) {
        return { kind: 'OK' as const, profile: { id: target.id, status: target.status } };
      }

      const updated = await tx.founderProfile.update({
        where: { id },
        data: { status: parsed.data.status },
        select: { id: true, status: true },
      });

      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: parsed.data.status === 'SUSPENDED' ? 'profile.suspend' : 'profile.publish',
        targetType: 'FounderProfile',
        targetId: id,
        metadata: {
          from: target.status,
          to: parsed.data.status,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        },
      });

      return { kind: 'OK' as const, profile: updated };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'PROFILE_NOT_FOUND', message: 'Profile not found' },
        { status: 404 },
      );
    }
    return NextResponse.json({ profile: result.profile }, { status: 200 });
  });
}
