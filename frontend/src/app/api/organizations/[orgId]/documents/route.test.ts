import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('GET /api/organizations/[orgId]/documents', () => {
  it('lists all documents across the org, annotated with project', async () => {
    prismaMock.document.findMany.mockResolvedValueOnce([
      {
        id: 'doc_1',
        url: 'https://x',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        project: { id: 'proj_1', name: 'Site web' },
        fileUpload: { filename: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
      },
    ] as never);

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/documents'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: unknown[] };
    expect(body.documents).toHaveLength(1);
  });
});
