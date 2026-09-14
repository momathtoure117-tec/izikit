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
  return new NextRequest('http://test/api/organizations/org_1/calendar-events', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeGet(month: string): NextRequest {
  return new NextRequest(`http://test/api/organizations/org_1/calendar-events?month=${month}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('POST /api/organizations/[orgId]/calendar-events', () => {
  it('creates an event and returns 201', async () => {
    prismaMock.calendarEvent.create.mockResolvedValueOnce({
      id: 'evt_1',
      title: 'Kickoff',
      description: null,
      startAt: new Date('2026-10-01T10:00:00Z'),
      endAt: null,
    } as never);

    const res = await POST(
      makePost({ title: 'Kickoff', startAt: '2026-10-01T10:00:00.000Z' }),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { title: string } };
    expect(body.event.title).toBe('Kickoff');
  });

  it('rejects an empty title with 400 VALIDATION_FAILED', async () => {
    const res = await POST(
      makePost({ title: '', startAt: '2026-10-01T10:00:00.000Z' }),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/organizations/[orgId]/calendar-events', () => {
  it('returns events and task deadlines for the given month', async () => {
    prismaMock.calendarEvent.findMany.mockResolvedValueOnce([
      {
        id: 'evt_1',
        title: 'Kickoff',
        description: null,
        startAt: new Date('2026-10-01T10:00:00Z'),
        endAt: null,
        createdById: 'u1',
      },
    ] as never);
    prismaMock.task.findMany.mockResolvedValueOnce([
      {
        id: 'task_1',
        title: 'Ship v1',
        dueAt: new Date('2026-10-15T00:00:00Z'),
        project: { id: 'proj_1', name: 'Site web' },
      },
    ] as never);

    const res = await GET(makeGet('2026-10'), ctxWith('org_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: unknown[];
      taskDeadlines: unknown[];
    };
    expect(body.events).toHaveLength(1);
    expect(body.taskDeadlines).toHaveLength(1);
  });

  it('rejects a malformed month with 400 VALIDATION_FAILED', async () => {
    const res = await GET(makeGet('not-a-month'), ctxWith('org_1'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
  });
});
