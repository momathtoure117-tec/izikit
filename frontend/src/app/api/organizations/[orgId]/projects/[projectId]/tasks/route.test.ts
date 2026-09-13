import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(
  orgId: string,
  projectId: string,
): {
  params: Promise<{ orgId: string; projectId: string }>;
} {
  return { params: Promise.resolve({ orgId, projectId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('POST /api/organizations/[orgId]/projects/[projectId]/tasks', () => {
  it("creates a task scoped to the project's org and returns 201", async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'p1' } as never);
    prismaMock.task.create.mockResolvedValueOnce({
      id: 't1',
      title: 'Design mock',
      status: 'TODO',
      assigneeId: null,
      dueAt: null,
    } as never);

    const res = await POST(
      new NextRequest('http://test/api/organizations/org_1/projects/p1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Design mock' }),
      }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { task: { id: string } };
    expect(body.task.id).toBe('t1');
  });

  it('returns 404 PROJECT_NOT_FOUND when the project is not in this org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null as never);
    const res = await POST(
      new NextRequest('http://test/api/organizations/org_1/projects/missing/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'x' }),
      }),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});
