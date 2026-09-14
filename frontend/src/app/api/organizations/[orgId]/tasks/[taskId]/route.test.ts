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

/** Well-formed cuid — satisfies zCuid so the request reaches the membership guard. */
const ASSIGNEE = 'cku2y3z4a5b6c7d8e9f0g1h2';

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

  it('omits unset fields from updateMany payload', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.task.findFirst.mockResolvedValueOnce({
      id: 't1',
      title: 'Existing title',
      status: 'IN_PROGRESS',
      assigneeId: null,
      dueAt: null,
    } as never);

    await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DONE' }),
      }),
      ctxWith('org_1', 't1'),
    );

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'DONE' },
      }),
    );
  });

  it('assigns the task when the assignee is a member of the org', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ userId: ASSIGNEE } as never);
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.task.findFirst.mockResolvedValueOnce({
      id: 't1',
      title: 'Design mock',
      status: 'TODO',
      assigneeId: ASSIGNEE,
      dueAt: null,
    } as never);

    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: ASSIGNEE }),
      }),
      ctxWith('org_1', 't1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { assigneeId: string } };
    expect(body.task.assigneeId).toBe(ASSIGNEE);
  });

  it('returns 400 ASSIGNEE_NOT_MEMBER when the assignee is not in the org', async () => {
    // A well-formed cuid used to reach the FK and surface as an unhandled 500.
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce(null as never);

    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: ASSIGNEE }),
      }),
      ctxWith('org_1', 't1'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ASSIGNEE_NOT_MEMBER');
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled();
  });

  it('allows an explicit null assigneeId (un-assign) without a membership lookup', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.task.findFirst.mockResolvedValueOnce({
      id: 't1',
      title: 'Design mock',
      status: 'TODO',
      assigneeId: null,
      dueAt: null,
    } as never);

    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: null }),
      }),
      ctxWith('org_1', 't1'),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.organizationMember.findUnique).not.toHaveBeenCalled();
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
