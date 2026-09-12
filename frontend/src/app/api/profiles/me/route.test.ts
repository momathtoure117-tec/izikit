import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

mockNextCookies();

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { GET, PUT } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/profiles/me', { method: 'GET' });
}

function makePut(body: unknown, opts: { csrf?: 'match' | 'missing' } = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/profiles/me', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __cookieStore.clear();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/profiles/me', () => {
  it('returns { profile: null } when none exists', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: null });
  });

  it('returns the existing profile scoped to the authed user', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValue({
      id: 'p1',
      bio: 'Bio',
      city: 'Dakar',
      sector: 'Tech',
      skills: ['React'],
      hasIdea: true,
      ideaPitch: 'Pitch',
      availableToCofound: false,
      externalLink: null,
      status: 'PUBLISHED',
    } as never);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.profile.id).toBe('p1');
    const args = prismaMock.founderProfile.findUnique.mock.calls[0]?.[0];
    expect(args?.where?.userId).toBe('user-1');
  });

  it('requireAuth bail -> 401', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/profiles/me', () => {
  it('missing CSRF -> 403', async () => {
    const res = await PUT(makePut({ bio: 'x', city: 'y', sector: 'z' }, { csrf: 'missing' }));
    expect(res.status).toBe(403);
    expect(prismaMock.founderProfile.upsert).not.toHaveBeenCalled();
  });

  it('invalid body -> 400 VALIDATION_FAILED', async () => {
    const res = await PUT(makePut({ bio: '', city: 'Dakar', sector: 'Tech' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('required fields + a role checked -> status PUBLISHED', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValue(null);
    prismaMock.founderProfile.upsert.mockResolvedValue({ id: 'p1', status: 'PUBLISHED' } as never);
    const res = await PUT(makePut({ bio: 'Bio', city: 'Dakar', sector: 'Tech', hasIdea: true }));
    expect(res.status).toBe(200);
    const upsertArg = prismaMock.founderProfile.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create?.status).toBe('PUBLISHED');
    expect(upsertArg?.create?.userId).toBe('user-1');
  });

  it('required fields but no role checked -> status DRAFT', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValue(null);
    prismaMock.founderProfile.upsert.mockResolvedValue({ id: 'p1', status: 'DRAFT' } as never);
    const res = await PUT(makePut({ bio: 'Bio', city: 'Dakar', sector: 'Tech' }));
    expect(res.status).toBe(200);
    const upsertArg = prismaMock.founderProfile.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create?.status).toBe('DRAFT');
  });

  it('existing SUSPENDED profile stays SUSPENDED even with a fully valid payload', async () => {
    prismaMock.founderProfile.findUnique.mockResolvedValue({ status: 'SUSPENDED' } as never);
    prismaMock.founderProfile.upsert.mockResolvedValue({ id: 'p1', status: 'SUSPENDED' } as never);
    const res = await PUT(makePut({ bio: 'Bio', city: 'Dakar', sector: 'Tech', hasIdea: true }));
    expect(res.status).toBe(200);
    const upsertArg = prismaMock.founderProfile.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.update?.status).toBe('SUSPENDED');
  });

  it('requireAuth bail -> 401, no upsert', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await PUT(makePut({ bio: 'Bio', city: 'Dakar', sector: 'Tech' }));
    expect(res.status).toBe(401);
    expect(prismaMock.founderProfile.upsert).not.toHaveBeenCalled();
  });
});
