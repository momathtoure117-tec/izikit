import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { POST, GET } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('POST /api/organizations/[orgId]/projects', () => {
  it('creates a project and returns 201', async () => {
    prismaMock.project.create.mockResolvedValueOnce({
      id: 'p1',
      name: 'Website redesign',
      description: null,
      status: 'ACTIVE',
    } as never);

    const res = await POST(makePost({ name: 'Website redesign' }), ctxWith('org_1'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string } };
    expect(body.project.id).toBe('p1');
  });

  it('returns 400 VALIDATION_FAILED for an empty name', async () => {
    const res = await POST(makePost({ name: '' }), ctxWith('org_1'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/organizations/[orgId]/projects', () => {
  it('lists projects with computed task counts', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'Website redesign',
        description: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        tasks: [{ status: 'DONE' }, { status: 'TODO' }, { status: 'DONE' }],
      },
    ] as never);

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/projects'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: { id: string; taskCounts: { total: number; done: number } }[];
    };
    expect(body.projects[0]?.taskCounts).toEqual({ total: 3, done: 2 });
  });
});
