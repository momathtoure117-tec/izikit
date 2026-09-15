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

// NOTE: 'proj_1' / 'proj_foreign' from the original plan draft are not valid
// cuid shapes and fail this route's `zCuid` validation (regex
// ^c[a-z0-9]{20,30}$). Corrected to well-formed cuid-shaped fixtures here.
const PROJ_1 = 'cproj1000000000000000001';
const PROJ_FOREIGN = 'cprojforeign00000000000001';

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/notes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('POST /api/organizations/[orgId]/notes', () => {
  it('creates a workspace-level note and returns 201', async () => {
    prismaMock.note.create.mockResolvedValueOnce({
      id: 'note_1',
      title: 'Idée',
      body: 'Contenu',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date('2026-10-01T10:00:00Z'),
      updatedAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    const res = await POST(makePost({ title: 'Idée', body: 'Contenu' }), ctxWith('org_1'));
    expect(res.status).toBe(201);
    const responseBody = (await res.json()) as { note: { title: string } };
    expect(responseBody.note.title).toBe('Idée');
  });

  it('creates a project-tagged note when projectId belongs to the org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: PROJ_1 } as never);
    prismaMock.note.create.mockResolvedValueOnce({
      id: 'note_2',
      title: 'Idée projet',
      body: 'Contenu',
      authorId: 'u1',
      projectId: PROJ_1,
      createdAt: new Date('2026-10-01T10:00:00Z'),
      updatedAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    const res = await POST(
      makePost({ title: 'Idée projet', body: 'Contenu', projectId: PROJ_1 }),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(201);
  });

  it('returns 404 PROJECT_NOT_FOUND for a foreign project', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      makePost({ title: 'x', body: 'y', projectId: PROJ_FOREIGN }),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(404);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe('PROJECT_NOT_FOUND');
  });

  it('rejects an empty title with 400 VALIDATION_FAILED', async () => {
    const res = await POST(makePost({ title: '', body: 'Contenu' }), ctxWith('org_1'));
    expect(res.status).toBe(400);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/organizations/[orgId]/notes', () => {
  it('lists notes newest first, annotated with project when present', async () => {
    prismaMock.note.findMany.mockResolvedValueOnce([
      {
        id: 'note_1',
        title: 'Idée',
        body: 'Contenu',
        authorId: 'u1',
        projectId: PROJ_1,
        project: { id: PROJ_1, name: 'Site web' },
        createdAt: new Date('2026-10-01T10:00:00Z'),
        updatedAt: new Date('2026-10-01T10:00:00Z'),
      },
    ] as never);

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/notes'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const responseBody = (await res.json()) as { notes: { project: { name: string } }[] };
    expect(responseBody.notes[0]!.project.name).toBe('Site web');
  });
});
