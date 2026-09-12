export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { ProfileInput, computeProfileStatus } from '@/lib/server/profiles/validation';

const PROFILE_SELECT = {
  id: true,
  bio: true,
  city: true,
  sector: true,
  skills: true,
  hasIdea: true,
  ideaPitch: true,
  availableToCofound: true,
  externalLink: true,
  status: true,
} as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const profile = await prisma.founderProfile.findUnique({
      where: { userId: auth.user.sub },
      select: PROFILE_SELECT,
    });

    return NextResponse.json(
      { profile },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const parsed = ProfileInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_FAILED',
          message: 'Invalid request body',
          issues: parsed.error.issues,
        },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const existing = await prisma.founderProfile.findUnique({
      where: { userId: auth.user.sub },
      select: { status: true },
    });
    // Admin-suspended profiles stay SUSPENDED until an admin republishes
    // them — editing your own profile must never silently lift a suspension.
    const status =
      existing?.status === 'SUSPENDED' ? 'SUSPENDED' : computeProfileStatus(parsed.data);

    const data = {
      bio: parsed.data.bio,
      city: parsed.data.city,
      sector: parsed.data.sector,
      skills: parsed.data.skills,
      hasIdea: parsed.data.hasIdea,
      availableToCofound: parsed.data.availableToCofound,
      status,
      ...(parsed.data.ideaPitch !== undefined ? { ideaPitch: parsed.data.ideaPitch } : {}),
      ...(parsed.data.externalLink !== undefined ? { externalLink: parsed.data.externalLink } : {}),
    };

    const profile = await prisma.founderProfile.upsert({
      where: { userId: auth.user.sub },
      create: { userId: auth.user.sub, ...data },
      update: data,
      select: PROFILE_SELECT,
    });

    return NextResponse.json(
      { profile },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
