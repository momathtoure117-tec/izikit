import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET, PATCH, DELETE } from './route';

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

describe('GET /api/organizations/[orgId]/projects/[projectId]', () => {
  it('returns the project with its tasks', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'p1',
      name: 'Website redesign',
      description: null,
      status: 'ACTIVE',
      tasks: [{ id: 't1', title: 'Design mock', status: 'TODO', assigneeId: null, dueAt: null }],
    } as never);
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/projects/p1'),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { id: string } };
    expect(body.project.id).toBe('p1');
  });

  it('returns 404 PROJECT_NOT_FOUND when the project is not in this org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null as never);
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/projects/missing'),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/organizations/[orgId]/projects/[projectId]', () => {
  it('updates the project and returns 200', async () => {
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'p1',
      name: 'New name',
      description: null,
      status: 'ACTIVE',
    } as never);
    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/projects/p1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New name' }),
      }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(200);
  });

  it('omits undefined fields from partial update payload', async () => {
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'p1',
      name: 'Updated name',
      description: null,
      status: 'ACTIVE',
    } as never);
    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/projects/p1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated name' }),
      }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Updated name' },
      }),
    );
  });
});

describe('DELETE /api/organizations/[orgId]/projects/[projectId]', () => {
  it('deletes the project and returns 204', async () => {
    prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 1 } as never);
    const res = await DELETE(
      new NextRequest('http://test/api/organizations/org_1/projects/p1', { method: 'DELETE' }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(204);
  });

  it('returns 404 PROJECT_NOT_FOUND when nothing was deleted', async () => {
    prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 0 } as never);
    const res = await DELETE(
      new NextRequest('http://test/api/organizations/org_1/projects/missing', { method: 'DELETE' }),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});
