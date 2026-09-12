export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const DIRECTORY_SELECT = {
  id: true,
  bio: true,
  city: true,
  sector: true,
  skills: true,
  hasIdea: true,
  availableToCofound: true,
  createdAt: true,
} as const satisfies Prisma.FounderProfileSelect;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const sector = url.searchParams.get('sector');
    const city = url.searchParams.get('city');
    const skill = url.searchParams.get('skill');
    const role = url.searchParams.get('role'); // 'idea' | 'available' | null
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.FounderProfileWhereInput = {
      status: 'PUBLISHED',
      ...(sector ? { sector } : {}),
      ...(city ? { city } : {}),
      ...(skill ? { skills: { has: skill } } : {}),
      ...(role === 'idea' ? { hasIdea: true } : {}),
      ...(role === 'available' ? { availableToCofound: true } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.founderProfile.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: DIRECTORY_SELECT,
    });

    const page = buildPage(rows, limit);
    return NextResponse.json(page, { headers: { 'x-request-id': ctx.requestId } });
  });
}
