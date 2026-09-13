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
});

describe('GET /api/organizations/[orgId]/tasks', () => {
  it('returns 400 VALIDATION_FAILED when ?assignee is missing or not "me"', async () => {
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/tasks'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(400);
  });

  it("lists the caller's tasks across all projects when ?assignee=me", async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        title: 'Design mock',
        status: 'TODO',
        dueAt: null,
        project: { id: 'p1', name: 'Website redesign' },
      },
    ] as never);

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/tasks?assignee=me'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1', assigneeId: 'u1' } }),
    );
    const body = (await res.json()) as { tasks: { id: string }[] };
    expect(body.tasks[0]?.id).toBe('t1');
  });
});
