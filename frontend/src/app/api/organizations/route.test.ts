import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { POST, GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const authCtx = { user: { sub: 'u1', email: 'u1@test.local' } };

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/organizations', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authCtx);
});

describe('POST /api/organizations', () => {
  it('creates an Organization + OWNER membership and returns 201', async () => {
    prismaMock.$transaction.mockImplementationOnce(async (fn: unknown) =>
      (fn as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock),
    );
    prismaMock.organization.create.mockResolvedValueOnce({
      id: 'org_1',
      slug: 'acme',
      name: 'Acme',
    } as never);
    prismaMock.organizationMember.create.mockResolvedValueOnce({} as never);

    const res = await POST(makePost({ name: 'Acme' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { organization: { id: string; role: string } };
    expect(body.organization.id).toBe('org_1');
    expect(body.organization.role).toBe('OWNER');
  });

  it('retries with a disambiguated slug when the first slug collides (P2002)', async () => {
    // Each ensureUniqueSlug attempt must open its OWN transaction — retrying inside a single
    // aborted Postgres transaction would surface as 25P02 and bubble up as a 500.
    prismaMock.$transaction.mockImplementation(async (fn: unknown) =>
      (fn as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock),
    );
    prismaMock.organization.create
      .mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        }) as never,
      )
      .mockResolvedValueOnce({ id: 'org_2', slug: 'acme-2', name: 'Acme' } as never);
    prismaMock.organizationMember.create.mockResolvedValue({} as never);

    const res = await POST(makePost({ name: 'Acme' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { organization: { id: string; slug: string; role: string } };
    expect(body.organization.slug).toBe('acme-2');
    expect(body.organization.id).toBe('org_2');
    expect(prismaMock.organization.create).toHaveBeenCalledTimes(2);
    // Two separate transactions, one per attempt.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('returns 400 VALIDATION_FAILED for an empty name', async () => {
    const res = await POST(makePost({ name: '' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/organizations', () => {
  it("lists the caller's workspaces with role", async () => {
    prismaMock.organizationMember.findMany.mockResolvedValueOnce([
      { role: 'OWNER', organization: { id: 'org_1', slug: 'acme', name: 'Acme' } },
    ] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizations: { id: string; role: string }[] };
    expect(body.organizations).toEqual([
      { id: 'org_1', slug: 'acme', name: 'Acme', role: 'OWNER' },
    ]);
  });
});
