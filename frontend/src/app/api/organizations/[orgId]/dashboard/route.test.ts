import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
  prismaMock.project.count.mockResolvedValue(2);
  prismaMock.task.count.mockResolvedValue(3);
  prismaMock.organizationMember.count.mockResolvedValue(4);
  prismaMock.task.findMany.mockResolvedValue([] as never);
  prismaMock.project.findMany.mockResolvedValue([] as never);
});

describe('GET /api/organizations/[orgId]/dashboard', () => {
  it('returns the aggregated dashboard summary with 200', async () => {
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/dashboard'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activeProjectsCount: number;
      memberCount: number;
      upcomingDeadlines: unknown[];
      recentActivity: unknown[];
      projectsProgress: unknown[];
    };
    expect(body.activeProjectsCount).toBe(2);
    expect(body.memberCount).toBe(4);
    expect(body.upcomingDeadlines).toEqual([]);
    expect(body.recentActivity).toEqual([]);
    expect(body.projectsProgress).toEqual([]);
  });
});
