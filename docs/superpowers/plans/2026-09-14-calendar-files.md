# CoFound Africa — Calendar + Documents/Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace calendar (events + task-deadline overview) and a
project-scoped document/file system, reusing the existing Cloudinary upload
pipeline and `FileUpload` audit table.

**Architecture:** Two new Prisma models (`CalendarEvent`, `Document`), five new
route handlers under `/api/organizations/[orgId]/...`, two new pages
(`/w/[orgSlug]/calendar`, `/w/[orgSlug]/files`), a "Documents" section added to
the existing project detail page, and two new sidebar nav items.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + Neon Postgres, Zod, Vitest +
vitest-mock-extended, existing Cloudinary upload infra (`/api/upload`).

**Spec:** `docs/superpowers/specs/2026-09-14-cofound-africa-calendar-files-design.md`

## Global Constraints

- Every Route Handler MUST `export const runtime = 'nodejs'`.
- Mutating routes call `verifyCsrf(req)` and bail early if it returns non-null, BEFORE `requireOrgRole`.
- Middleware short-circuit checks use the exact convention `if (auth instanceof NextResponse) return auth;` — no cast, never `instanceof Response`. Test mocks of a middleware failure MUST use `NextResponse.json({...}, { status })`, never a plain `new Response(...)`.
- Route params are `ctx: { params: Promise<{...}> }`, awaited via `await ctx.params`.
- Responses use `NextResponse.json(...)` with an `x-request-id` header sourced from `reqCtx.requestId`.
- Every content page: destructure `notFound` from `useWorkspace()` and render the shared `WorkspaceNotFound` component (`@/components/workspace-not-found`) before the loading/error/data branches. Loading guard is `if (wsLoading || loading || !data)`. `error` from `useApi` is surfaced via `Alert variant="destructive"` + a "Réessayer" retry button (`window.location.reload()`), checked before the loading fallback.
- Any mutation that should update a page's list calls `refresh()` from `useApi` in its success path only (never in `catch`, never relying on a bare cache-invalidation helper alone).
- `CalendarEvent.startAt`/`endAt` and `Task.dueAt` are `DateTime`; API bodies accept ISO datetime strings (`z.string().datetime()`), converted to `Date` at the route boundary.
- `Project`/`Task`/`Organization`/`OrganizationMember`/`FileUpload` are existing model names — do not rename them.
- Existing design system: `components/ui/*` (Button, Card, Badge, Input, Textarea, Label, Alert, Progress), lucide-react icons only (no emoji), indigo/slate palette.

---

### Task 1: Add CalendarEvent & Document Prisma models

**Files:**
- Modify: `frontend/prisma/schema.prisma`
- Create: migration via `pnpm db:migrate:dev --name add_calendar_document`

**Interfaces:**
- Produces: `prisma.calendarEvent` and `prisma.document` Prisma Client delegates, consumed by every route task below.

- [ ] **Step 1: Add the two models to `frontend/prisma/schema.prisma`**

Add after the `Task` model:

```prisma
model CalendarEvent {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  title          String
  description    String?
  startAt        DateTime
  endAt          DateTime?
  createdById    String
  createdBy      User         @relation("CalendarEventCreator", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId, startAt])
}

model Document {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId      String
  project        Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  fileUploadId   String       @unique
  fileUpload     FileUpload   @relation(fields: [fileUploadId], references: [id], onDelete: Restrict)
  url            String
  uploadedById   String
  uploadedBy     User         @relation("DocumentUploader", fields: [uploadedById], references: [id], onDelete: Restrict)
  createdAt      DateTime     @default(now())

  @@index([organizationId])
  @@index([projectId])
}
```

- [ ] **Step 2: Add back-relations on `Organization`, `Project`, `User`, and `FileUpload`**

On `Organization`, alongside the existing `projects`/`tasks` relations, add:

```prisma
  calendarEvents CalendarEvent[]
  documents      Document[]
```

On `Project`, alongside the existing `tasks` relation, add:

```prisma
  documents Document[]
```

On `User`, alongside the existing `projectsCreated`/`tasksCreated`/`tasksAssigned` relations, add:

```prisma
  calendarEventsCreated CalendarEvent[] @relation("CalendarEventCreator")
  documentsUploaded     Document[]      @relation("DocumentUploader")
```

On `FileUpload`, add (this row can optionally become one `Document`):

```prisma
  document Document?
```

- [ ] **Step 3: Run the migration**

Run: `cd frontend && pnpm db:migrate:dev --name add_calendar_document`
Expected: migration applies cleanly, no data loss (both are new tables).

- [ ] **Step 4: Verify the client generates correctly**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: no errors — confirms `prisma.calendarEvent`/`prisma.document` delegates exist with the right shape.

- [ ] **Step 5: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations
git commit -m "feat(workspace): add CalendarEvent and Document Prisma models"
```

---

### Task 2: Calendar events — create and list

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/calendar-events/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/calendar-events/route.test.ts`

**Interfaces:**
- Consumes: `prisma.calendarEvent`, `prisma.task` (Task 1, existing).
- Produces: `POST` → `{ event: { id, title, description, startAt, endAt } }` (201). `GET ?month=YYYY-MM` → `{ events: [{id,title,description,startAt,endAt,createdById}], taskDeadlines: [{id,title,dueAt,project:{id,name}}] }` (200) — consumed by Task 7 (calendar page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/calendar-events/route.test.ts`:

```ts
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
  return new NextRequest(
    `http://test/api/organizations/org_1/calendar-events?month=${month}`,
    { method: 'GET' },
  );
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
    const res = await POST(makePost({ title: '', startAt: '2026-10-01T10:00:00.000Z' }), ctxWith('org_1'));
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/calendar-events/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/calendar-events/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
});

const MonthQuery = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const event = await prisma.calendarEvent.create({
      data: {
        organizationId: orgId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        startAt: new Date(parsed.data.startAt),
        endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
        createdById: auth.user.sub,
      },
      select: { id: true, title: true, description: true, startAt: true, endAt: true },
    });

    return NextResponse.json(
      { event },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const monthParam = new URL(req.url).searchParams.get('month') ?? '';
    const parsed = MonthQuery.safeParse(monthParam);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'month must be YYYY-MM' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const [year, month] = parsed.data.split('-').map(Number);
    const rangeStart = new Date(Date.UTC(year, month - 1, 1));
    const rangeEnd = new Date(Date.UTC(year, month, 1));

    const [events, tasks] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { organizationId: orgId, startAt: { gte: rangeStart, lt: rangeEnd } },
        select: {
          id: true,
          title: true,
          description: true,
          startAt: true,
          endAt: true,
          createdById: true,
        },
        orderBy: { startAt: 'asc' },
      }),
      prisma.task.findMany({
        where: {
          organizationId: orgId,
          dueAt: { gte: rangeStart, lt: rangeEnd },
        },
        select: {
          id: true,
          title: true,
          dueAt: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { dueAt: 'asc' },
      }),
    ]);

    return NextResponse.json(
      { events, taskDeadlines: tasks },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/calendar-events/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/calendar-events"
git commit -m "feat(workspace): add calendar events create/list route"
```

---

### Task 3: Calendar event delete

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/calendar-events/[eventId]/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/calendar-events/[eventId]/route.test.ts`

**Interfaces:**
- Consumes: `prisma.calendarEvent` (Task 1).
- Produces: `DELETE` → 204, or 403 `FORBIDDEN_NOT_OWNER` / 404 `EVENT_NOT_FOUND`. Consumed by Task 7 (calendar page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/calendar-events/[eventId]/route.test.ts`:

```ts
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

function ctxWith(orgId: string, eventId: string): { params: Promise<{ orgId: string; eventId: string }> } {
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
    expect(res.status).toBe(204);
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
    expect(res.status).toBe(204);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/calendar-events/[eventId]/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/calendar-events/[eventId]/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; eventId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, eventId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const event = await prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true, createdById: true },
    });

    if (!event || event.organizationId !== orgId) {
      return NextResponse.json(
        { error: 'EVENT_NOT_FOUND', message: 'Event not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const isCreator = event.createdById === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isCreator && !isAdminOrOwner) {
      return NextResponse.json(
        { error: 'FORBIDDEN_NOT_OWNER', message: 'Only the creator or an admin can delete this event' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await prisma.calendarEvent.delete({ where: { id: eventId } });

    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/calendar-events/[eventId]/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/calendar-events/[eventId]"
git commit -m "feat(workspace): add calendar event delete route with creator-or-admin guard"
```

---

### Task 4: Attach an upload to a project (create Document)

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts`

**Interfaces:**
- Consumes: `prisma.document`, `prisma.fileUpload`, `prisma.project` (existing).
- Produces: `POST` → `{ document: { id, url, createdAt, fileUpload: {filename, mimeType, sizeBytes} } }` (201), or 404 `PROJECT_NOT_FOUND` / 404 `UPLOAD_NOT_FOUND` / 409 `ALREADY_ATTACHED`. Consumed by Task 9 (project detail page's Documents section).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts`:

```ts
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

function ctxWith(orgId: string, projectId: string): { params: Promise<{ orgId: string; projectId: string }> } {
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
      makePost({ fileUploadId: 'up_1', url: 'https://res.cloudinary.com/x/raw/upload/u1/abc' }),
      ctxWith('org_1', 'proj_1'),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { document: { id: string } };
    expect(body.document.id).toBe('doc_1');
  });

  it('returns 404 PROJECT_NOT_FOUND for a project in another org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      makePost({ fileUploadId: 'up_1', url: 'https://x' }),
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
      makePost({ fileUploadId: 'up_1', url: 'https://x' }),
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
      makePost({ fileUploadId: 'up_1', url: 'https://x' }),
      ctxWith('org_1', 'proj_1'),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ALREADY_ATTACHED');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zCuid } from '@/lib/server/zod-helpers';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  fileUploadId: zCuid,
  url: z.string().url(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; projectId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, projectId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const upload = await prisma.fileUpload.findUnique({
      where: { id: parsed.data.fileUploadId },
      select: { id: true, userId: true, filename: true, mimeType: true, sizeBytes: true },
    });
    if (!upload || upload.userId !== auth.user.sub) {
      return NextResponse.json(
        { error: 'UPLOAD_NOT_FOUND', message: 'Upload not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const existing = await prisma.document.findUnique({
      where: { fileUploadId: upload.id },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'ALREADY_ATTACHED', message: 'This upload is already attached to a project' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const document = await prisma.document.create({
      data: {
        organizationId: orgId,
        projectId,
        fileUploadId: upload.id,
        url: parsed.data.url,
        uploadedById: auth.user.sub,
      },
      select: {
        id: true,
        url: true,
        createdAt: true,
        fileUpload: { select: { filename: true, mimeType: true, sizeBytes: true } },
      },
    });

    return NextResponse.json(
      { document },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents"
git commit -m "feat(workspace): add document-attach route reusing FileUpload"
```

---

### Task 5: List documents (project-scoped and org-wide)

**Files:**
- Modify: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.ts` (add `GET` alongside the existing `POST` from Task 4)
- Modify: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts` (add `GET` tests)
- Create: `frontend/src/app/api/organizations/[orgId]/documents/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/documents/route.test.ts`

**Interfaces:**
- Produces: `GET .../projects/[projectId]/documents` → `{ documents: [{id,url,createdAt,fileUpload:{filename,mimeType,sizeBytes}}] }` (200). `GET .../documents` → `{ documents: [{id,url,createdAt,project:{id,name},fileUpload:{filename,mimeType,sizeBytes}}] }` (200). Consumed by Task 8 (Fichiers page) and Task 9 (project detail Documents section).

- [ ] **Step 1: Add the failing GET test to the existing file**

Append to `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts` (add `GET` to the existing import line, and add this new `describe` block at the end of the file):

Change:
```ts
import { POST } from './route';
```
to:
```ts
import { POST, GET } from './route';
```

Append:

```ts
describe('GET /api/organizations/[orgId]/projects/[projectId]/documents', () => {
  it('lists documents for the project', async () => {
    prismaMock.document.findMany.mockResolvedValueOnce([
      {
        id: 'doc_1',
        url: 'https://x',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        fileUpload: { filename: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
      },
    ] as never);

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/projects/proj_1/documents'),
      ctxWith('org_1', 'proj_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: unknown[] };
    expect(body.documents).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write the failing org-wide test**

Create `frontend/src/app/api/organizations/[orgId]/documents/route.test.ts`:

```ts
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
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts" "src/app/api/organizations/[orgId]/documents/route.test.ts"`
Expected: FAIL — `GET` not exported from either route yet.

- [ ] **Step 4: Add GET to the project-scoped route**

Append to `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.ts`:

```ts

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; projectId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId, projectId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const documents = await prisma.document.findMany({
      where: { organizationId: orgId, projectId },
      select: {
        id: true,
        url: true,
        createdAt: true,
        fileUpload: { select: { filename: true, mimeType: true, sizeBytes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      { documents },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 5: Implement the org-wide route**

Create `frontend/src/app/api/organizations/[orgId]/documents/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const documents = await prisma.document.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        url: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
        fileUpload: { select: { filename: true, mimeType: true, sizeBytes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      { documents },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/documents/route.test.ts" "src/app/api/organizations/[orgId]/documents/route.test.ts"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/projects/[projectId]/documents" "frontend/src/app/api/organizations/[orgId]/documents"
git commit -m "feat(workspace): add project-scoped and org-wide document list routes"
```

---

### Task 6: Document delete

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/documents/[documentId]/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/documents/[documentId]/route.test.ts`

**Interfaces:**
- Consumes: `prisma.document`, `cloudinary.uploader.destroy` via `@/lib/server/upload/cloudinary-client` (existing — see Step 3 for the exact import; if no destroy helper is exported yet, add one there, it's a small addition to an otherwise-protected-adjacent file, NOT a change to the protected files list which only covers `oauth/google.ts`, `webhook/handler.ts`, `payments/circuit-breaker.ts`, `outbox/dispatcher.ts`, `admin/audit.ts`, `middleware/index.ts`+`require-admin.ts`+`require-org-role.ts`, `observability/request-context.ts`, `instrumentation.ts`, `lib/api.ts` — `upload/cloudinary-client.ts` is NOT on that list, it's fair-game project surface).
- Produces: `DELETE` → 204, or 403 `FORBIDDEN_NOT_OWNER` / 404 `DOCUMENT_NOT_FOUND`.

- [ ] **Step 1: Add a `destroyUpload` helper to the existing Cloudinary client**

Append to `frontend/src/lib/server/upload/cloudinary-client.ts` (before the final `__resetCloudinarySingleton` export, or after — position doesn't matter as long as it's a top-level export):

```ts
/**
 * Best-effort delete of a Cloudinary asset by its public_id. Callers should
 * catch and log on failure rather than aborting a DB deletion — an orphaned
 * Cloudinary asset is a cheap, recoverable cost; a DB row that can never be
 * deleted because Cloudinary is briefly unreachable is not acceptable.
 */
export async function destroyUpload(publicId: string): Promise<void> {
  configureOnce();
  await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
}
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/documents/[documentId]/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));
vi.mock('@/lib/server/upload/cloudinary-client', () => ({ destroyUpload: vi.fn(async () => undefined) }));

import { requireOrgRole } from '@/lib/server/middleware';
import { destroyUpload } from '@/lib/server/upload/cloudinary-client';
import { DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockDestroyUpload = vi.mocked(destroyUpload);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string, documentId: string): { params: Promise<{ orgId: string; documentId: string }> } {
  return { params: Promise.resolve({ orgId, documentId }) };
}

function makeDelete(): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/documents/doc_1', { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('DELETE /api/organizations/[orgId]/documents/[documentId]', () => {
  it('deletes the document and its upload, calling destroyUpload first', async () => {
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
    expect(res.status).toBe(204);
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
    expect(res.status).toBe(204);
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/documents/[documentId]/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 4: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/documents/[documentId]/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { destroyUpload } from '@/lib/server/upload/cloudinary-client';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; documentId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, documentId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        organizationId: true,
        uploadedById: true,
        fileUploadId: true,
        fileUpload: { select: { key: true } },
      },
    });

    if (!doc || doc.organizationId !== orgId) {
      return NextResponse.json(
        { error: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const isUploader = doc.uploadedById === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isUploader && !isAdminOrOwner) {
      return NextResponse.json(
        { error: 'FORBIDDEN_NOT_OWNER', message: 'Only the uploader or an admin can delete this document' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    try {
      await destroyUpload(doc.fileUpload.key);
    } catch (err) {
      log.warn('document.destroyUpload failed, continuing with DB delete', { err, documentId });
    }

    await prisma.document.delete({ where: { id: doc.id } });
    await prisma.fileUpload.delete({ where: { id: doc.fileUploadId } });

    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
```


- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/documents/[documentId]/route.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/documents/[documentId]" frontend/src/lib/server/upload/cloudinary-client.ts
git commit -m "feat(workspace): add document delete route with best-effort Cloudinary cleanup"
```

---

### Task 7: Calendar page

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/calendar/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()` (existing), `GET`/`POST`/`DELETE /api/organizations/[orgId]/calendar-events` (Tasks 2-3).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/calendar/page.tsx`:

```tsx
'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface CalendarEventRow {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  createdById: string;
}

interface TaskDeadlineRow {
  id: string;
  title: string;
  dueAt: string;
  project: { id: string; name: string };
}

interface CalendarResponse {
  events: CalendarEventRow[];
  taskDeadlines: TaskDeadlineRow[];
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(year: number, month0: number): Date[] {
  const days: Date[] = [];
  const d = new Date(Date.UTC(year, month0, 1));
  while (d.getUTCMonth() === month0) {
    days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

export default function CalendarPage() {
  const { organizationId, loading: wsLoading, notFound } = useWorkspace();
  const [cursor, setCursor] = useState(() => new Date());
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const month = monthKey(cursor);
  const path = organizationId
    ? `/api/organizations/${organizationId}/calendar-events?month=${month}`
    : '';
  const { data, loading, error, refresh } = useApi<CalendarResponse>(path, {
    skip: !organizationId,
  });

  const days = useMemo(
    () => daysInMonth(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger le calendrier.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim() || !startAt) {
      setFormError('Le titre et la date sont obligatoires.');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/organizations/${organizationId}/calendar-events`, {
        method: 'POST',
        body: { title: title.trim(), startAt: new Date(startAt).toISOString() },
      });
      setTitle('');
      setStartAt('');
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(eventId: string) {
    try {
      await api(`/api/organizations/${organizationId}/calendar-events/${eventId}`, {
        method: 'DELETE',
      });
      await refresh();
    } catch {
      // errors surfaced via the page-level Alert on next fetch if persistent
    }
  }

  const eventsByDay = new Map<string, CalendarEventRow[]>();
  const deadlinesByDay = new Map<string, TaskDeadlineRow[]>();
  for (const ev of data.events) {
    const key = ev.startAt.slice(0, 10);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), ev]);
  }
  for (const t of data.taskDeadlines) {
    const key = t.dueAt.slice(0, 10);
    deadlinesByDay.set(key, [...(deadlinesByDay.get(key) ?? []), t]);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-indigo-600" />
          <h1 className="text-xl font-semibold text-slate-900">Calendrier</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-slate-700">
            {cursor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-title">Titre</Label>
              <Input
                id="event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Réunion équipe"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-start">Date</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting} className="gap-2">
              <Plus className="h-4 w-4" />
              {submitting ? 'Ajout…' : 'Nouvel événement'}
            </Button>
          </form>
          {formError && (
            <Alert variant="destructive" role="alert" className="mt-3">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const dayEvents = eventsByDay.get(key) ?? [];
          const dayDeadlines = deadlinesByDay.get(key) ?? [];
          if (dayEvents.length === 0 && dayDeadlines.length === 0) return null;
          return (
            <Card key={key}>
              <CardContent className="flex flex-col gap-2 pt-4">
                <span className="text-xs font-semibold text-slate-500">
                  {day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
                {dayEvents.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-900">{ev.title}</span>
                    <button
                      type="button"
                      onClick={() => onDelete(ev.id)}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Supprimer ${ev.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {dayDeadlines.map((t) => (
                  <div key={t.id} className="text-sm text-indigo-700">
                    {t.title} <span className="text-xs text-slate-400">({t.project.name})</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
        {days.every((day) => {
          const key = day.toISOString().slice(0, 10);
          return (eventsByDay.get(key)?.length ?? 0) === 0 && (deadlinesByDay.get(key)?.length ?? 0) === 0;
        }) && <p className="text-sm text-slate-500">Aucun événement ce mois-ci.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the full validation gate**

Run: `cd frontend && pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass. Client pages have no dedicated Vitest suite in this codebase (existing precedent) — no test file for this page.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/calendar"
git commit -m "feat(workspace): add calendar page (events + task deadlines)"
```

---

### Task 8: Files page (org-wide document list)

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/files/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `GET /api/organizations/[orgId]/documents` (Task 5), `DELETE /api/organizations/[orgId]/documents/[documentId]` (Task 6).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/files/page.tsx`:

```tsx
'use client';

import { FileText, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface DocumentRow {
  id: string;
  url: string;
  createdAt: string;
  project: { id: string; name: string };
  fileUpload: { filename: string; mimeType: string; sizeBytes: number };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function FilesPage() {
  const { organizationId, loading: wsLoading, notFound } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/documents` : '';
  const { data, loading, error, refresh } = useApi<{ documents: DocumentRow[] }>(path, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les fichiers.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  async function onDelete(documentId: string) {
    try {
      await api(`/api/organizations/${organizationId}/documents/${documentId}`, {
        method: 'DELETE',
      });
      await refresh();
    } catch {
      // errors surfaced via the page-level Alert on next fetch if persistent
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <FileText className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Fichiers</h1>
      </header>

      {data.documents.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun fichier pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between gap-3 pt-4">
                <div className="flex min-w-0 flex-col">
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-medium text-indigo-600 hover:underline"
                  >
                    {doc.fileUpload.filename}
                  </a>
                  <span className="text-xs text-slate-500">
                    {doc.project.name} · {formatBytes(doc.fileUpload.sizeBytes)} ·{' '}
                    {new Date(doc.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(doc.id)}
                  className="shrink-0 text-slate-400 hover:text-red-600"
                  aria-label={`Supprimer ${doc.fileUpload.filename}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the full validation gate**

Run: `cd frontend && pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/files"
git commit -m "feat(workspace): add org-wide files page"
```

---

### Task 9: Add a Documents section to the project detail page

**Files:**
- Modify: `frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx`

**Interfaces:**
- Consumes: `GET`/`POST .../projects/[projectId]/documents` (Tasks 4-5), `DELETE /api/organizations/[orgId]/documents/[documentId]` (Task 6), existing `POST /api/upload`.

- [ ] **Step 1: Read the existing file first**

Read `frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx` in full before editing — this task ADDS a section, it does not rewrite the page. The file's existing import line is:

```tsx
import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
```

Note the existing `useApi` call for the project data and the existing
`refresh()`-after-mutation pattern used for task creation/status-cycling
(established in sub-project 1) — the new Documents section must follow the
exact same pattern: upload → attach → `refresh()` on success only.

**Important — `api()` cannot upload files.** `frontend/src/lib/api.ts` (a
protected file — do not modify it) always sets `Content-Type: application/json`
and `JSON.stringify(body)`s its `body` argument, so it cannot send
`multipart/form-data`. The upload step to `/api/upload` must use a raw
`fetch()` call instead, replicating just enough of `api()`'s CSRF-header and
credentials behavior manually (`credentials: 'include'` + an `x-csrf-token`
header read from the `<COOKIE_PREFIX>-csrf` cookie) — the exact code for this
is in Step 2 below, no judgment call needed.

- [ ] **Step 2: Add document state, an upload handler, and a Documents section to the render**

Update the file's import line to merge in the new imports:

```tsx
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, AlertCircle, Paperclip, Trash2 as TrashIcon } from 'lucide-react';
import Link from 'next/link';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { COOKIE_PREFIX } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
```

Add this interface near the file's other interfaces:

```tsx
interface DocumentRow {
  id: string;
  url: string;
  createdAt: string;
  fileUpload: { filename: string; mimeType: string; sizeBytes: number };
}
```

Inside the page component, alongside the existing project `useApi` call, add a second `useApi` call for this project's documents:

```tsx
const documentsPath = organizationId
  ? `/api/organizations/${organizationId}/projects/${projectId}/documents`
  : '';
const {
  data: documentsData,
  refresh: refreshDocuments,
} = useApi<{ documents: DocumentRow[] }>(documentsPath, { skip: !organizationId });
```

Add upload state and a file input ref:

```tsx
const fileInputRef = useRef<HTMLInputElement>(null);
const [uploading, setUploading] = useState(false);
const [uploadError, setUploadError] = useState<string | null>(null);
```

Add the upload handler (two-step: raw `fetch` to `/api/upload` since it needs
multipart, then `api()` to attach via the Task 4 route since that's plain JSON):

```tsx
function readCsrfCookie(): string | null {
  const name = `${COOKIE_PREFIX}-csrf`;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

async function onUploadFile(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  setUploadError(null);
  setUploading(true);
  try {
    const form = new FormData();
    form.append('file', file);
    const csrfToken = readCsrfCookie();
    const uploadRes = await fetch('/api/upload', {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
    });
    if (!uploadRes.ok) {
      throw new Error('upload failed');
    }
    const uploaded = (await uploadRes.json()) as { id: string; url: string };
    await api(`/api/organizations/${organizationId}/projects/${projectId}/documents`, {
      method: 'POST',
      body: { fileUploadId: uploaded.id, url: uploaded.url },
    });
    await refreshDocuments();
  } catch (err) {
    setUploadError(err instanceof ApiError ? err.message : "Échec de l'envoi du fichier.");
  } finally {
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
}

async function onDeleteDocument(documentId: string) {
  try {
    await api(`/api/organizations/${organizationId}/documents/${documentId}`, { method: 'DELETE' });
    await refreshDocuments();
  } catch {
    // best-effort; a persistent failure surfaces on the next page load's list mismatch
  }
}
```

Add the Documents section to the page's JSX, after the existing task list section:

```tsx
<section className="mt-8">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
    <label className="cursor-pointer">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={onUploadFile}
        disabled={uploading}
      />
      <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <Paperclip className="h-4 w-4" />
        {uploading ? 'Envoi…' : 'Ajouter un fichier'}
      </span>
    </label>
  </div>
  {uploadError && (
    <Alert variant="destructive" role="alert" className="mb-3">
      <AlertDescription>{uploadError}</AlertDescription>
    </Alert>
  )}
  {(documentsData?.documents.length ?? 0) === 0 ? (
    <p className="text-sm text-slate-500">Aucun document pour l&apos;instant.</p>
  ) : (
    <div className="flex flex-col gap-2">
      {documentsData?.documents.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
        >
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm font-medium text-indigo-600 hover:underline"
          >
            {doc.fileUpload.filename}
          </a>
          <button
            type="button"
            onClick={() => onDeleteDocument(doc.id)}
            className="shrink-0 text-slate-400 hover:text-red-600"
            aria-label={`Supprimer ${doc.fileUpload.filename}`}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )}
</section>
```

Adjust variable names above (`organizationId`, `projectId`) to match whatever this file's existing destructured variable names actually are — read the file first (Step 1) and use its existing names, don't introduce a second set of differently-named variables for the same values.

- [ ] **Step 3: Run the full validation gate**

Run: `cd frontend && pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx"
git commit -m "feat(workspace): add document upload/list/delete to project detail page"
```

---

### Task 10: Sidebar — add Calendrier and Fichiers nav items

**Files:**
- Modify: `frontend/src/app/w/[orgSlug]/layout.tsx`

**Interfaces:**
- None new — purely a nav-list edit.

- [ ] **Step 1: Read the existing file first**

Read `frontend/src/app/w/[orgSlug]/layout.tsx` in full before editing. Find the array of nav items (likely named `NAV_ITEMS` or similar) that currently lists Tableau de bord / Projets / Mes tâches / Équipe.

- [ ] **Step 2: Add the two new items**

Add `Calendar` and `FileText` (or `Files`) to the existing `lucide-react` import line. Insert a "Calendrier" entry (href `` `/w/${slug}/calendar` ``, icon `Calendar`) right after "Projets" and before "Mes tâches", and a "Fichiers" entry (href `` `/w/${slug}/files` ``, icon `FileText`) right after "Équipe" — matching the ordering decided in the spec: Tableau de bord, Projets, Calendrier, Mes tâches, Équipe, Fichiers. Match the exact object shape and `slug`-interpolation style already used by the existing entries in this array — do not introduce a different shape.

- [ ] **Step 3: Run the full validation gate**

Run: `cd frontend && pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/layout.tsx"
git commit -m "feat(workspace): add Calendrier and Fichiers to the sidebar"
```
