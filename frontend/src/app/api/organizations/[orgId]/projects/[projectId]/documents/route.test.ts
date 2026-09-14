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

/** Well-formed cuid — satisfies zCuid so the request reaches the handler logic. */
const FILE_UPLOAD_ID = 'cku2y3z4a5b6c7d8e9f0g1h2';

function ctxWith(
  orgId: string,
  projectId: string,
): { params: Promise<{ orgId: string; projectId: string }> } {
  return { params: Promise.resolve({ orgId, projectId }) };
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/projects/proj_1/documents', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('POST /api/organizations/[orgId]/projects/[projectId]/documents', () => {
  it('attaches an owned, unattached upload and returns 201', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj_1' } as never);
    prismaMock.fileUpload.findUnique.mockResolvedValueOnce({
      id: 'up_1',
      userId: 'u1',
      filename: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    } as never);
    prismaMock.document.findUnique.mockResolvedValueOnce(null);
    prismaMock.document.create.mockResolvedValueOnce({
      id: 'doc_1',
      url: 'https://res.cloudinary.com/x/raw/upload/u1/abc',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      fileUpload: { filename: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
    } as never);

    const res = await POST(
      makePost({
        fileUploadId: FILE_UPLOAD_ID,
        url: 'https://res.cloudinary.com/x/raw/upload/u1/abc',
      }),
      ctxWith('org_1', 'proj_1'),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { document: { id: string } };
    expect(body.document.id).toBe('doc_1');
  });

  it('returns 404 PROJECT_NOT_FOUND for a project in another org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      makePost({ fileUploadId: FILE_UPLOAD_ID, url: 'https://x' }),
      ctxWith('org_1', 'proj_1'),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROJECT_NOT_FOUND');
  });

  it('returns 404 UPLOAD_NOT_FOUND when the upload does not belong to the caller', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj_1' } as never);
    prismaMock.fileUpload.findUnique.mockResolvedValueOnce({
      id: 'up_1',
      userId: 'someone_else',
    } as never);

    const res = await POST(
      makePost({ fileUploadId: FILE_UPLOAD_ID, url: 'https://x' }),
      ctxWith('org_1', 'proj_1'),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('UPLOAD_NOT_FOUND');
  });

  it('returns 409 ALREADY_ATTACHED when the upload is already a Document', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj_1' } as never);
    prismaMock.fileUpload.findUnique.mockResolvedValueOnce({
      id: 'up_1',
      userId: 'u1',
    } as never);
    prismaMock.document.findUnique.mockResolvedValueOnce({ id: 'doc_existing' } as never);

    const res = await POST(
      makePost({ fileUploadId: FILE_UPLOAD_ID, url: 'https://x' }),
      ctxWith('org_1', 'proj_1'),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ALREADY_ATTACHED');
  });
});
