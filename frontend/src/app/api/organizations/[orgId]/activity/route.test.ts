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
  prismaMock.project.findMany.mockResolvedValue([]);
  prismaMock.task.findMany.mockResolvedValue([]);
  prismaMock.calendarEvent.findMany.mockResolvedValue([]);
  prismaMock.document.findMany.mockResolvedValue([]);
  prismaMock.message.findMany.mockResolvedValue([]);
  prismaMock.note.findMany.mockResolvedValue([]);
  prismaMock.organizationMember.findMany.mockResolvedValue([]);
});

describe('GET /api/organizations/[orgId]/activity', () => {
  it('returns an empty activity list when the org has no data', async () => {
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/activity'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activity: unknown[] };
    expect(body.activity).toEqual([]);
  });

  it('merges and sorts entries from multiple sources by createdAt descending', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      {
        id: 'proj_1',
        name: 'Site web',
        createdAt: new Date('2026-10-01T09:00:00Z'),
        createdBy: { name: 'Awa Diop', email: 'awa@test.local' },
      },
    ] as never);
    prismaMock.document.findMany.mockResolvedValueOnce([
      {
        id: 'doc_1',
        createdAt: new Date('2026-10-01T11:00:00Z'),
        uploadedBy: { name: null, email: 'ibra@test.local' },
        fileUpload: { filename: 'contrat.pdf' },
      },
    ] as never);

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/activity'),
      ctxWith('org_1'),
    );
    const body = (await res.json()) as { activity: { type: string; actorName: string }[] };
    expect(body.activity).toHaveLength(2);
    expect(body.activity[0]!.type).toBe('document');
    expect(body.activity[0]!.actorName).toBe('ibra@test.local');
    expect(body.activity[1]!.type).toBe('project');
    expect(body.activity[1]!.actorName).toBe('Awa Diop');
  });

  it('caps the result at 30 entries', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `proj_${i}`,
      name: `Projet ${i}`,
      createdAt: new Date(2026, 9, 1, 0, i),
      createdBy: { name: 'Awa', email: 'awa@test.local' },
    }));
    prismaMock.project.findMany.mockResolvedValueOnce(rows as never);
    prismaMock.task.findMany.mockResolvedValueOnce(
      rows.map((r) => ({ ...r, title: r.name, createdBy: r.createdBy })) as never,
    );

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/activity'),
      ctxWith('org_1'),
    );
    const body = (await res.json()) as { activity: unknown[] };
    expect(body.activity).toHaveLength(30);
  });
});
