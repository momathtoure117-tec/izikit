import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const adminCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'ADMIN' as const },
};

function ctxWith(
  orgId: string,
  userId: string,
): { params: Promise<{ orgId: string; userId: string }> } {
  return { params: Promise.resolve({ orgId, userId }) };
}

function makePatch(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/members/u2', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function makeDelete(): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/members/u2', { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(adminCtx);
  prismaMock.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock),
  );
});

describe('PATCH /api/organizations/[orgId]/members/[userId]', () => {
  it('updates the role and returns 200', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);
    prismaMock.organizationMember.update.mockResolvedValueOnce({ role: 'ADMIN' } as never);

    const res = await PATCH(makePatch({ role: 'ADMIN' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { role: string } };
    expect(body.member.role).toBe('ADMIN');
  });

  it('refuses to demote the last OWNER with 409 LAST_OWNER', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(1);

    const res = await PATCH(makePatch({ role: 'MEMBER' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LAST_OWNER');
  });
});

describe('DELETE /api/organizations/[orgId]/members/[userId]', () => {
  it('removes the member and returns 204', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);
    prismaMock.organizationMember.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(204);
  });

  it('refuses to remove the last OWNER with 409 LAST_OWNER', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(1);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LAST_OWNER');
  });
});
