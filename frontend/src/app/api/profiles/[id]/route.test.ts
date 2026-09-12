import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeGet(id: string): { req: NextRequest; ctx: { params: Promise<{ id: string }> } } {
  return {
    req: new NextRequest(`http://test/api/profiles/${id}`, { method: 'GET' }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

function seedProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    userId: 'owner-1',
    bio: 'Bio',
    city: 'Dakar',
    sector: 'Tech',
    skills: ['React'],
    hasIdea: true,
    ideaPitch: 'Pitch',
    availableToCofound: false,
    externalLink: null,
    status: 'PUBLISHED',
    user: { email: 'owner@example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/profiles/[id]', () => {
  it('404 when the profile does not exist', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce(null);
    const { req, ctx } = makeGet('missing');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('404 when the profile is DRAFT and the requester is not the owner', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce(
      seedProfile({ status: 'DRAFT' }) as never,
    );
    const { req, ctx } = makeGet('p1');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('the owner can view their own DRAFT profile, contact always revealed', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce(
      seedProfile({ status: 'DRAFT', userId: 'user-1' }) as never,
    );
    const { req, ctx } = makeGet('p1');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.isOwner).toBe(true);
    expect(body.profile.isUnlocked).toBe(true);
    expect(body.profile.contactEmail).toBe('owner@example.com');
    expect(prismaMock.profileUnlock.findUnique).not.toHaveBeenCalled();
  });

  it('non-owner, not unlocked -> contactEmail null, unlockPriceFcfa present', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce(seedProfile() as never);
    prismaMock.profileUnlock.findUnique.mockResolvedValueOnce(null);
    const { req, ctx } = makeGet('p1');
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.profile.isOwner).toBe(false);
    expect(body.profile.isUnlocked).toBe(false);
    expect(body.profile.contactEmail).toBeNull();
    expect(body.profile.unlockPriceFcfa).toBe(500);
  });

  it('non-owner, already unlocked -> contactEmail revealed', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce(seedProfile() as never);
    prismaMock.profileUnlock.findUnique.mockResolvedValueOnce({ id: 'u1' } as never);
    const { req, ctx } = makeGet('p1');
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.profile.isUnlocked).toBe(true);
    expect(body.profile.contactEmail).toBe('owner@example.com');
    const args = prismaMock.profileUnlock.findUnique.mock.calls[0]?.[0];
    expect(args?.where?.unlockerUserId_targetProfileId).toEqual({
      unlockerUserId: 'user-1',
      targetProfileId: 'p1',
    });
  });

  it('requireAuth bail -> 401', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const { req, ctx } = makeGet('p1');
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });
});
