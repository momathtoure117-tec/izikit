import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const orgCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(orgCtx);
});

describe('GET /api/organizations/[orgId]', () => {
  it('returns 200 { organization } for a member', async () => {
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      id: 'org_1',
      slug: 'acme',
      name: 'Acme',
    } as never);
    const res = await GET(new NextRequest('http://test/api/organizations/org_1'), ctxWith('org_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organization: { id: string } };
    expect(body.organization.id).toBe('org_1');
  });

  it('propagates the 404 from requireOrgRole for a non-member', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'Organization not found' }, { status: 404 }) as never,
    );
    const res = await GET(new NextRequest('http://test/api/organizations/org_1'), ctxWith('org_1'));
    expect(res.status).toBe(404);
  });
});
