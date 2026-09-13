export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { slugify, ensureUniqueSlug } from '@/lib/server/slug';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const base = slugify(parsed.data.name) || 'workspace';

    // The slug-collision retry MUST stay OUTSIDE the interactive transaction: on Postgres a
    // failed statement aborts the whole transaction (no per-statement savepoints), so a retry
    // issued inside it would fail with 25P02 instead of succeeding. Each attempt therefore
    // opens its own transaction, which still creates the Organization + OWNER member atomically.
    let created: { id: string; slug: string; name: string } | undefined;
    const slug = await ensureUniqueSlug(base, async (candidate) => {
      created = await prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { slug: candidate, name: parsed.data.name, ownerId: auth.user.sub },
          select: { id: true, slug: true, name: true },
        });
        await tx.organizationMember.create({
          data: { organizationId: org.id, userId: auth.user.sub, role: 'OWNER' },
        });
        return org;
      });
    });
    if (!created) throw new Error('organization creation failed');
    const organization = { ...created, slug };

    return NextResponse.json(
      { organization: { ...organization, role: 'OWNER' } },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: auth.user.sub },
      select: { role: true, organization: { select: { id: true, slug: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(
      {
        organizations: memberships.map((m) => ({
          id: m.organization.id,
          slug: m.organization.slug,
          name: m.organization.name,
          role: m.role,
        })),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
