import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));
vi.mock('@/lib/server/organizations/guards', () => ({ isOrgMember: vi.fn() }));
vi.mock('@/lib/server/notifications', () => ({ createNotification: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { isOrgMember } from '@/lib/server/organizations/guards';
import { createNotification } from '@/lib/server/notifications';
import { POST, GET } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockIsOrgMember = vi.mocked(isOrgMember);
const mockCreateNotification = vi.mocked(createNotification);
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
  return new NextRequest('http://test/api/organizations/org_1/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeGet(query = ''): NextRequest {
  return new NextRequest(`http://test/api/organizations/org_1/messages${query}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
  mockIsOrgMember.mockResolvedValue(true);
  mockCreateNotification.mockResolvedValue(null);
});

describe('POST /api/organizations/[orgId]/messages', () => {
  it('creates a general-channel message and returns 201', async () => {
    prismaMock.message.create.mockResolvedValueOnce({
      id: 'msg_1',
      body: 'Bonjour équipe',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    const res = await POST(makePost({ body: 'Bonjour équipe' }), ctxWith('org_1'));
    expect(res.status).toBe(201);
    const responseBody = (await res.json()) as { message: { body: string; projectId: null } };
    expect(responseBody.message.body).toBe('Bonjour équipe');
    expect(responseBody.message.projectId).toBeNull();
  });

  it('creates a project-scoped message when projectId is provided and belongs to the org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: PROJ_1 } as never);
    prismaMock.message.create.mockResolvedValueOnce({
      id: 'msg_2',
      body: 'Point projet',
      authorId: 'u1',
      projectId: PROJ_1,
      createdAt: new Date('2026-10-01T10:05:00Z'),
    } as never);

    const res = await POST(makePost({ body: 'Point projet', projectId: PROJ_1 }), ctxWith('org_1'));
    expect(res.status).toBe(201);
    const responseBody = (await res.json()) as { message: { projectId: string } };
    expect(responseBody.message.projectId).toBe(PROJ_1);
  });

  it('returns 404 PROJECT_NOT_FOUND for a project in another org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      makePost({ body: 'Point projet', projectId: PROJ_FOREIGN }),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(404);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe('PROJECT_NOT_FOUND');
  });

  it('rejects an empty body with 400 VALIDATION_FAILED', async () => {
    const res = await POST(makePost({ body: '' }), ctxWith('org_1'));
    expect(res.status).toBe(400);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/organizations/[orgId]/messages', () => {
  it('returns the general channel oldest-to-newest when no projectId is given', async () => {
    prismaMock.message.findMany.mockResolvedValueOnce([
      {
        id: 'msg_2',
        body: 'Second',
        authorId: 'u1',
        projectId: null,
        createdAt: new Date('2026-10-01T10:05:00Z'),
      },
      {
        id: 'msg_1',
        body: 'First',
        authorId: 'u1',
        projectId: null,
        createdAt: new Date('2026-10-01T10:00:00Z'),
      },
    ] as never);

    const res = await GET(makeGet(), ctxWith('org_1'));
    expect(res.status).toBe(200);
    const responseBody = (await res.json()) as { messages: { id: string }[] };
    expect(responseBody.messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2']);
    expect(prismaMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1', projectId: null } }),
    );
  });

  it('scopes to a project when projectId is given', async () => {
    prismaMock.message.findMany.mockResolvedValueOnce([]);

    await GET(makeGet(`?projectId=${PROJ_1}`), ctxWith('org_1'));
    expect(prismaMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1', projectId: PROJ_1 } }),
    );
  });
});

describe('POST /api/organizations/[orgId]/messages — mentions', () => {
  it('fires one notification per valid mentioned member', async () => {
    prismaMock.message.create.mockResolvedValueOnce({
      id: 'msg_1',
      body: 'Salut @[Awa Diop](cku2y3z4a5b6c7d8e9f0g1h2), regarde ça',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    await POST(
      makePost({ body: 'Salut @[Awa Diop](cku2y3z4a5b6c7d8e9f0g1h2), regarde ça' }),
      ctxWith('org_1'),
    );

    expect(mockIsOrgMember).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'cku2y3z4a5b6c7d8e9f0g1h2',
    );
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const [, input] = mockCreateNotification.mock.calls[0]!;
    expect(input.userId).toBe('cku2y3z4a5b6c7d8e9f0g1h2');
    expect(input.dedupeKey).toBe('mention:msg_1:cku2y3z4a5b6c7d8e9f0g1h2');
  });

  it('silently drops a mention for a user who is no longer a member', async () => {
    mockIsOrgMember.mockResolvedValueOnce(false);
    prismaMock.message.create.mockResolvedValueOnce({
      id: 'msg_2',
      body: 'Salut @[Ancien Membre](ckuoldmember00000000001)',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    const res = await POST(
      makePost({ body: 'Salut @[Ancien Membre](ckuoldmember00000000001)' }),
      ctxWith('org_1'),
    );

    expect(res.status).toBe(201);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('does not fail the message if createNotification throws unexpectedly', async () => {
    mockCreateNotification.mockRejectedValueOnce(new Error('db blip'));
    prismaMock.message.create.mockResolvedValueOnce({
      id: 'msg_3',
      body: 'Salut @[Awa Diop](cku2y3z4a5b6c7d8e9f0g1h2)',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    const res = await POST(
      makePost({ body: 'Salut @[Awa Diop](cku2y3z4a5b6c7d8e9f0g1h2)' }),
      ctxWith('org_1'),
    );

    expect(res.status).toBe(201);
  });

  it('creates a message with no mention tokens without calling isOrgMember', async () => {
    prismaMock.message.create.mockResolvedValueOnce({
      id: 'msg_4',
      body: 'Pas de mention ici',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    await POST(makePost({ body: 'Pas de mention ici' }), ctxWith('org_1'));

    expect(mockIsOrgMember).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
