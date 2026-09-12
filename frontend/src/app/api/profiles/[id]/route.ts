export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { PROFILE_UNLOCK_PRICE_FCFA } from '@/lib/server/profiles/constants';

export async function GET(
  req: NextRequest,
  ctxParams: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctxParams.params;
    const profile = await prisma.founderProfile.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        bio: true,
        city: true,
        sector: true,
        skills: true,
        hasIdea: true,
        ideaPitch: true,
        availableToCofound: true,
        externalLink: true,
        status: true,
        user: { select: { email: true } },
      },
    });

    const isOwner = profile?.userId === auth.user.sub;
    if (!profile || (profile.status !== 'PUBLISHED' && !isOwner)) {
      return NextResponse.json(
        { error: 'PROFILE_NOT_FOUND', message: 'Profile not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    let isUnlocked = isOwner;
    if (!isUnlocked) {
      const unlock = await prisma.profileUnlock.findUnique({
        where: {
          unlockerUserId_targetProfileId: { unlockerUserId: auth.user.sub, targetProfileId: id },
        },
        select: { id: true },
      });
      isUnlocked = unlock !== null;
    }

    return NextResponse.json(
      {
        profile: {
          id: profile.id,
          bio: profile.bio,
          city: profile.city,
          sector: profile.sector,
          skills: profile.skills,
          hasIdea: profile.hasIdea,
          ideaPitch: profile.ideaPitch,
          availableToCofound: profile.availableToCofound,
          externalLink: profile.externalLink,
          status: profile.status,
          isOwner,
          isUnlocked,
          contactEmail: isUnlocked ? profile.user.email : null,
          unlockPriceFcfa: PROFILE_UNLOCK_PRICE_FCFA,
        },
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
