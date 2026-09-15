import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const authorCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};
const adminCtx = {
  user: { sub: 'u2', email: 'u2@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u2', role: 'ADMIN' as const },
};
const otherMemberCtx = {
  user: { sub: 'u3', email: 'u3@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u3', role: 'MEMBER' as const },
};

function ctxWith(
  orgId: string,
  noteId: string,
): { params: Promise<{ orgId: string; noteId: string }> } {
  return { params: Promise.resolve({ orgId, noteId }) };
}

function makePatch(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/notes/note_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function makeDelete(): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/notes/note_1', { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/organizations/[orgId]/notes/[noteId]', () => {
  it('updates when the caller is the author', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(authorCtx);
    prismaMock.note.findUnique.mockResolvedValueOnce({
      id: 'note_1',
      organizationId: 'org_1',
      authorId: 'u1',
    } as never);
    prismaMock.note.update.mockResolvedValueOnce({
      id: 'note_1',
      title: 'Titre modifié',
      body: 'Contenu',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(makePatch({ title: 'Titre modifié' }), ctxWith('org_1', 'note_1'));
    expect(res.status).toBe(200);
  });

  it('updates when the caller is an ADMIN, even if not the author', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.note.findUnique.mockResolvedValueOnce({
      id: 'note_1',
      organizationId: 'org_1',
      authorId: 'u1',
    } as never);
    prismaMock.note.update.mockResolvedValueOnce({
      id: 'note_1',
      title: 'x',
      body: 'y',
      authorId: 'u1',
      projectId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(makePatch({ title: 'x' }), ctxWith('org_1', 'note_1'));
    expect(res.status).toBe(200);
  });

  it('refuses a non-author, non-admin MEMBER with 403 FORBIDDEN_NOT_OWNER', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(otherMemberCtx);
    prismaMock.note.findUnique.mockResolvedValueOnce({
      id: 'note_1',
      organizationId: 'org_1',
      authorId: 'u1',
    } as never);

    const res = await PATCH(makePatch({ title: 'x' }), ctxWith('org_1', 'note_1'));
    expect(res.status).toBe(403);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe('FORBIDDEN_NOT_OWNER');
    expect(prismaMock.note.update).not.toHaveBeenCalled();
  });

  it('returns 404 NOTE_NOT_FOUND for a missing note', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(authorCtx);
    prismaMock.note.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatch({ title: 'x' }), ctxWith('org_1', 'note_1'));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/organizations/[orgId]/notes/[noteId]', () => {
  it('deletes when the caller is the author and returns 200 with a JSON body', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(authorCtx);
    prismaMock.note.findUnique.mockResolvedValueOnce({
      id: 'note_1',
      organizationId: 'org_1',
      authorId: 'u1',
    } as never);
    prismaMock.note.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'note_1'));
    expect(res.status).toBe(200);
    const responseBody = (await res.json()) as { success: boolean };
    expect(responseBody.success).toBe(true);
  });

  it('refuses a non-author, non-admin MEMBER with 403 FORBIDDEN_NOT_OWNER', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(otherMemberCtx);
    prismaMock.note.findUnique.mockResolvedValueOnce({
      id: 'note_1',
      organizationId: 'org_1',
      authorId: 'u1',
    } as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'note_1'));
    expect(res.status).toBe(403);
    expect(prismaMock.note.delete).not.toHaveBeenCalled();
  });

  it('returns 404 NOTE_NOT_FOUND for a missing note', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(authorCtx);
    prismaMock.note.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'note_1'));
    expect(res.status).toBe(404);
  });
});
