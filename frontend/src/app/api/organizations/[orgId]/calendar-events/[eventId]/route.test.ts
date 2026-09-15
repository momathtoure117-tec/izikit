import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};
const adminCtx = {
  user: { sub: 'u2', email: 'u2@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u2', role: 'ADMIN' as const },
};

function ctxWith(
  orgId: string,
  eventId: string,
): { params: Promise<{ orgId: string; eventId: string }> } {
  return { params: Promise.resolve({ orgId, eventId }) };
}

function makeDelete(): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/calendar-events/evt_1', {
    method: 'DELETE',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/organizations/[orgId]/calendar-events/[eventId]', () => {
  it('deletes the event when the caller is the creator', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(memberCtx);
    prismaMock.calendarEvent.findUnique.mockResolvedValueOnce({
      id: 'evt_1',
      organizationId: 'org_1',
      createdById: 'u1',
    } as never);
    prismaMock.calendarEvent.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'evt_1'));
    expect(res.status).toBe(200);
  });

  it('deletes the event when the caller is an ADMIN, even if not the creator', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.calendarEvent.findUnique.mockResolvedValueOnce({
      id: 'evt_1',
      organizationId: 'org_1',
      createdById: 'u1',
    } as never);
    prismaMock.calendarEvent.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'evt_1'));
    expect(res.status).toBe(200);
  });

  it('refuses a plain MEMBER who is not the creator with 403 FORBIDDEN_NOT_OWNER', async () => {
    mockRequireOrgRole.mockResolvedValueOnce({
      user: { sub: 'u3', email: 'u3@test.local' },
      orgMember: { organizationId: 'org_1', userId: 'u3', role: 'MEMBER' as const },
    });
    prismaMock.calendarEvent.findUnique.mockResolvedValueOnce({
      id: 'evt_1',
      organizationId: 'org_1',
      createdById: 'u1',
    } as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'evt_1'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('FORBIDDEN_NOT_OWNER');
    expect(prismaMock.calendarEvent.delete).not.toHaveBeenCalled();
  });

  it('returns 404 EVENT_NOT_FOUND for a missing event', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(memberCtx);
    prismaMock.calendarEvent.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'evt_1'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('EVENT_NOT_FOUND');
  });
});
