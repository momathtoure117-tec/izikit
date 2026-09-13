import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(
  orgId: string,
  taskId: string,
): { params: Promise<{ orgId: string; taskId: string }> } {
  return { params: Promise.resolve({ orgId, taskId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('PATCH /api/organizations/[orgId]/tasks/[taskId]', () => {
  it('updates the task status and returns 200', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.task.findFirst.mockResolvedValueOnce({
      id: 't1',
      title: 'Design mock',
      status: 'DONE',
      assigneeId: null,
      dueAt: null,
    } as never);

    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DONE' }),
      }),
      ctxWith('org_1', 't1'),
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 TASK_NOT_FOUND when nothing was updated', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 } as never);
    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/missing', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DONE' }),
      }),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/organizations/[orgId]/tasks/[taskId]', () => {
  it('deletes the task and returns 204', async () => {
    prismaMock.task.deleteMany.mockResolvedValueOnce({ count: 1 } as never);
    const res = await DELETE(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', { method: 'DELETE' }),
      ctxWith('org_1', 't1'),
    );
    expect(res.status).toBe(204);
  });
});
