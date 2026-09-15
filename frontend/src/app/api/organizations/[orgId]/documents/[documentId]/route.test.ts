import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));
vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  destroyUpload: vi.fn(async () => undefined),
}));

import { requireOrgRole } from '@/lib/server/middleware';
import { destroyUpload } from '@/lib/server/upload/cloudinary-client';
import { DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockDestroyUpload = vi.mocked(destroyUpload);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(
  orgId: string,
  documentId: string,
): { params: Promise<{ orgId: string; documentId: string }> } {
  return { params: Promise.resolve({ orgId, documentId }) };
}

function makeDelete(): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/documents/doc_1', {
    method: 'DELETE',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('DELETE /api/organizations/[orgId]/documents/[documentId]', () => {
  it('deletes the document and its upload, then best-effort destroys the Cloudinary asset', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc_1',
      organizationId: 'org_1',
      uploadedById: 'u1',
      fileUploadId: 'up_1',
      fileUpload: { key: 'u1/abc' },
    } as never);
    prismaMock.document.delete.mockResolvedValueOnce({} as never);
    prismaMock.fileUpload.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'doc_1'));
    expect(res.status).toBe(200);
    expect(mockDestroyUpload).toHaveBeenCalledWith('u1/abc');
    expect(prismaMock.document.delete).toHaveBeenCalled();
  });

  it('still deletes the rows even if destroyUpload throws', async () => {
    mockDestroyUpload.mockRejectedValueOnce(new Error('cloudinary down'));
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc_1',
      organizationId: 'org_1',
      uploadedById: 'u1',
      fileUploadId: 'up_1',
      fileUpload: { key: 'u1/abc' },
    } as never);
    prismaMock.document.delete.mockResolvedValueOnce({} as never);
    prismaMock.fileUpload.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'doc_1'));
    expect(res.status).toBe(200);
    expect(prismaMock.document.delete).toHaveBeenCalled();
  });

  it('refuses a non-uploader plain MEMBER with 403 FORBIDDEN_NOT_OWNER', async () => {
    mockRequireOrgRole.mockResolvedValueOnce({
      user: { sub: 'u2', email: 'u2@test.local' },
      orgMember: { organizationId: 'org_1', userId: 'u2', role: 'MEMBER' as const },
    });
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc_1',
      organizationId: 'org_1',
      uploadedById: 'u1',
      fileUploadId: 'up_1',
      fileUpload: { key: 'u1/abc' },
    } as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'doc_1'));
    expect(res.status).toBe(403);
    expect(prismaMock.document.delete).not.toHaveBeenCalled();
  });

  it('returns 404 DOCUMENT_NOT_FOUND for a missing document', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'doc_1'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DOCUMENT_NOT_FOUND');
  });
});
