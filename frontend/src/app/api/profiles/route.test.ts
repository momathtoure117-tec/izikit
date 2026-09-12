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

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function seedProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    bio: 'Bio',
    city: 'Dakar',
    sector: 'Tech',
    skills: ['React'],
    hasIdea: true,
    availableToCofound: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/profiles', () => {
  it('lists PUBLISHED profiles sorted by createdAt DESC', async () => {
    prismaMock.founderProfile.findMany.mockResolvedValueOnce([
      seedProfile({ id: 'p1' }),
      seedProfile({ id: 'p2' }),
    ] as never);
    const res = await GET(makeGet('http://test/api/profiles'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
    const args = prismaMock.founderProfile.findMany.mock.calls[0]?.[0];
    expect((args?.where as Record<string, unknown>)?.status).toBe('PUBLISHED');
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('never selects the related user (no email leak from the directory)', async () => {
    prismaMock.founderProfile.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/profiles'));
    const args = prismaMock.founderProfile.findMany.mock.calls[0]?.[0];
    expect((args?.select as Record<string, unknown> | undefined)?.['user']).toBeUndefined();
  });

  it('filters by sector', async () => {
    prismaMock.founderProfile.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/profiles?sector=Tech'));
    const args = prismaMock.founderProfile.findMany.mock.calls[0]?.[0];
    expect((args?.where as Record<string, unknown>)?.sector).toBe('Tech');
  });

  it('filters by role=idea -> hasIdea true', async () => {
    prismaMock.founderProfile.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/profiles?role=idea'));
    const args = prismaMock.founderProfile.findMany.mock.calls[0]?.[0];
    expect((args?.where as Record<string, unknown>)?.hasIdea).toBe(true);
  });

  it('filters by skill using array "has"', async () => {
    prismaMock.founderProfile.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/profiles?skill=React'));
    const args = prismaMock.founderProfile.findMany.mock.calls[0]?.[0];
    expect((args?.where as Record<string, unknown>)?.skills).toEqual({ has: 'React' });
  });

  it('requireAuth bail -> 401', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet('http://test/api/profiles'));
    expect(res.status).toBe(401);
  });
});
