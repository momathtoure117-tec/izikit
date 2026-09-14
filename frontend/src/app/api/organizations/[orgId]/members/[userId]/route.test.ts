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
const ownerCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'OWNER' as const },
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
    mockRequireOrgRole.mockResolvedValue(ownerCtx);
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(1);

    const res = await PATCH(makePatch({ role: 'MEMBER' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LAST_OWNER');
  });

  it('refuses an ADMIN promoting a MEMBER to OWNER with 403 ORG_ROLE_INSUFFICIENT', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);

    const res = await PATCH(makePatch({ role: 'OWNER' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ORG_ROLE_INSUFFICIENT');
    expect(prismaMock.organizationMember.update).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN demoting an existing OWNER with 403 ORG_ROLE_INSUFFICIENT', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(2);

    const res = await PATCH(makePatch({ role: 'MEMBER' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ORG_ROLE_INSUFFICIENT');
    expect(prismaMock.organizationMember.update).not.toHaveBeenCalled();
  });

  it('lets an OWNER promote a MEMBER to OWNER', async () => {
    mockRequireOrgRole.mockResolvedValue(ownerCtx);
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);
    prismaMock.organizationMember.update.mockResolvedValueOnce({ role: 'OWNER' } as never);

    const res = await PATCH(makePatch({ role: 'OWNER' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { role: string } };
    expect(body.member.role).toBe('OWNER');
  });

  it('lets an OWNER demote another OWNER when one remains', async () => {
    mockRequireOrgRole.mockResolvedValue(ownerCtx);
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(2);
    prismaMock.organizationMember.update.mockResolvedValueOnce({ role: 'MEMBER' } as never);

    const res = await PATCH(makePatch({ role: 'MEMBER' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { role: string } };
    expect(body.member.role).toBe('MEMBER');
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
    mockRequireOrgRole.mockResolvedValue(ownerCtx);
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(1);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LAST_OWNER');
  });

  it('refuses an ADMIN removing an OWNER with 403 ORG_ROLE_INSUFFICIENT', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(2);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ORG_ROLE_INSUFFICIENT');
    expect(prismaMock.organizationMember.delete).not.toHaveBeenCalled();
  });

  it('lets an OWNER remove another OWNER when one remains', async () => {
    mockRequireOrgRole.mockResolvedValue(ownerCtx);
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(2);
    prismaMock.organizationMember.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(204);
  });
});
