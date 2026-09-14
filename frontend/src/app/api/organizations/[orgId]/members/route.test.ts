import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};
const adminCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'ADMIN' as const },
};

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/members', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/organizations/[orgId]/members', () => {
  it('lists members', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(memberCtx);
    prismaMock.organizationMember.findMany.mockResolvedValueOnce([
      { role: 'OWNER', user: { id: 'u1', email: 'u1@test.local', name: null } },
    ] as never);
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/members'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { userId: string; role: string }[] };
    expect(body.members).toEqual([
      { userId: 'u1', email: 'u1@test.local', name: null, role: 'OWNER' },
    ]);
  });
});

describe('POST /api/organizations/[orgId]/members', () => {
  it('invites an existing user by email and returns 201', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u2', email: 'u2@test.local' } as never);
    prismaMock.organizationMember.create.mockResolvedValueOnce({ role: 'MEMBER' } as never);

    const res = await POST(makePost({ email: 'u2@test.local' }), ctxWith('org_1'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { member: { userId: string; role: string } };
    expect(body.member).toEqual({ userId: 'u2', email: 'u2@test.local', role: 'MEMBER' });
  });

  it('returns 404 USER_NOT_FOUND when the email matches no account', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never);

    const res = await POST(makePost({ email: 'nobody@test.local' }), ctxWith('org_1'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('USER_NOT_FOUND');
  });

  it('returns 429 TOO_MANY_INVITE_ATTEMPTS when the per-email limit is hit', async () => {
    // The 404/409/201 split makes this endpoint an account-existence oracle; the per-email
    // limiter caps how often one address can be probed.
    mockRequireOrgRole.mockResolvedValue(adminCtx);
    prismaMock.user.findUnique.mockResolvedValue(null as never);

    const calls = await Promise.all(
      Array.from({ length: 6 }, () =>
        POST(makePost({ email: 'rate-target@test.local' }), ctxWith('org_1')),
      ),
    );
    const limited = calls.find((r) => r.status === 429);
    expect(limited, 'expected at least one 429 across 6 invites of the same email').toBeDefined();
    const body = (await limited!.json()) as { error: string };
    expect(body.error).toBe('TOO_MANY_INVITE_ATTEMPTS');
  });

  it('returns 409 ALREADY_MEMBER on a unique-constraint collision', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u2', email: 'u2@test.local' } as never);
    prismaMock.organizationMember.create.mockRejectedValueOnce({ code: 'P2002' });

    const res = await POST(makePost({ email: 'u2@test.local' }), ctxWith('org_1'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ALREADY_MEMBER');
  });
});
