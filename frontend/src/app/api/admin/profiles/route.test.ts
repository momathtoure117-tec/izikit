import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return { ...actual, verifyCsrf: vi.fn() };
});
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { verifyCsrf } from '@/lib/server/auth';
import { logAdminAction } from '@/lib/server/admin/audit';
import { GET } from './route';
import { PATCH as PATCH_STATUS } from './[id]/status/route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockVerifyCsrf = vi.mocked(verifyCsrf);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminCtx = {
  user: { sub: 'admin-1', email: 'admin@test.local' },
  admin: { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function makePatch(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsOf(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
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
    availableToCofound: false,
    status: 'PUBLISHED',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: { email: 'owner@example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
  mockVerifyCsrf.mockReturnValue(null);
  mockLogAdminAction.mockResolvedValue(undefined);
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
});

describe('GET /api/admin/profiles', () => {
  it('returns paginated profiles for ADMIN', async () => {
    prismaMock.founderProfile.findMany.mockResolvedValueOnce([
      seedProfile({ id: 'p1' }),
      seedProfile({ id: 'p2' }),
    ] as never);
    const res = await GET(makeGet('http://test/api/admin/profiles'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
  });

  it('filters by status', async () => {
    prismaMock.founderProfile.findMany.mockResolvedValueOnce([] as never);
    await GET(makeGet('http://test/api/admin/profiles?status=SUSPENDED'));
    const args = prismaMock.founderProfile.findMany.mock.calls[0]?.[0];
    expect((args?.where as Record<string, unknown>)?.status).toBe('SUSPENDED');
  });

  it('requireAdmin bail -> propagates the response', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/profiles'));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/profiles/[id]/status', () => {
  it('PUBLISHED -> SUSPENDED writes AdminAction profile.suspend', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce({
      id: 'p1',
      status: 'PUBLISHED',
    } as never);
    prismaMock.founderProfile.update.mockResolvedValueOnce({
      id: 'p1',
      status: 'SUSPENDED',
    } as never);

    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/profiles/p1/status', {
        status: 'SUSPENDED',
        reason: 'spam',
      }),
      paramsOf('p1'),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { id: string; status: string } };
    expect(body.profile).toEqual({ id: 'p1', status: 'SUSPENDED' });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'profile.suspend',
        targetType: 'FounderProfile',
        targetId: 'p1',
        metadata: { from: 'PUBLISHED', to: 'SUSPENDED', reason: 'spam' },
      }),
    );
  });

  it('SUSPENDED -> PUBLISHED writes AdminAction profile.publish', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce({
      id: 'p1',
      status: 'SUSPENDED',
    } as never);
    prismaMock.founderProfile.update.mockResolvedValueOnce({
      id: 'p1',
      status: 'PUBLISHED',
    } as never);

    await PATCH_STATUS(
      makePatch('http://test/api/admin/profiles/p1/status', { status: 'PUBLISHED' }),
      paramsOf('p1'),
    );

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'profile.publish' }),
    );
  });

  it('same-status PATCH is a no-op: no update, no AdminAction', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce({
      id: 'p1',
      status: 'PUBLISHED',
    } as never);

    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/profiles/p1/status', { status: 'PUBLISHED' }),
      paramsOf('p1'),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.founderProfile.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('missing profile -> 404 PROFILE_NOT_FOUND', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/profiles/missing/status', { status: 'SUSPENDED' }),
      paramsOf('missing'),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PROFILE_NOT_FOUND');
  });

  it('invalid body -> 400 VALIDATION_FAILED', async () => {
    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/profiles/p1/status', { status: 'BOGUS' }),
      paramsOf('p1'),
    );
    expect(res.status).toBe(400);
  });

  it('CSRF failure -> 403, requireAdmin never called', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 }),
    );
    const res = await PATCH_STATUS(
      makePatch('http://test/api/admin/profiles/p1/status', { status: 'SUSPENDED' }),
      paramsOf('p1'),
    );
    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
    expect(prismaMock.founderProfile.update).not.toHaveBeenCalled();
  });
});
