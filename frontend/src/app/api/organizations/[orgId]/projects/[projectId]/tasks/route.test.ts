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

/** Well-formed cuid — satisfies zCuid so the request reaches the membership guard. */
const ASSIGNEE = 'cku2y3z4a5b6c7d8e9f0g1h2';

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

  it('creates a task with an assignee who is a member of the org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'p1' } as never);
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ userId: ASSIGNEE } as never);
    prismaMock.task.create.mockResolvedValueOnce({
      id: 't1',
      title: 'Design mock',
      status: 'TODO',
      assigneeId: ASSIGNEE,
      dueAt: null,
    } as never);

    const res = await POST(
      new NextRequest('http://test/api/organizations/org_1/projects/p1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Design mock', assigneeId: ASSIGNEE }),
      }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { task: { assigneeId: string } };
    expect(body.task.assigneeId).toBe(ASSIGNEE);
  });

  it('returns 400 ASSIGNEE_NOT_MEMBER when the assignee is not in the org', async () => {
    // A well-formed cuid used to reach the FK and surface as an unhandled 500.
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'p1' } as never);
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce(null as never);

    const res = await POST(
      new NextRequest('http://test/api/organizations/org_1/projects/p1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Design mock', assigneeId: ASSIGNEE }),
      }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ASSIGNEE_NOT_MEMBER');
    expect(prismaMock.task.create).not.toHaveBeenCalled();
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
