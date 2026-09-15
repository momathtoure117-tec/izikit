# CoFound Africa — Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared workspace messaging channel + per-project discussion
threads, a mention system feeding the existing (previously unused)
notifications backend, simple notes, and a read-only recent-activity feed.

**Architecture:** Two new Prisma models (`Message`, `Note`), five new/extended
route handlers under `/api/organizations/[orgId]/...` plus an additive filter
on the existing `/api/notifications` route, six new pages, a "Discussions"
section added to the existing project detail page, and sidebar changes
(section headers + new nav items + a notification bell).

**Tech Stack:** Next.js 16 App Router, Prisma 5 + Neon Postgres, Zod, Vitest +
vitest-mock-extended, the existing `Notification`/`createNotification`
backend (previously built but unused by any frontend page).

**Spec:** `docs/superpowers/specs/2026-09-14-cofound-africa-collaboration-design.md`

## Global Constraints

- Every Route Handler MUST `export const runtime = 'nodejs'`.
- Mutating routes call `verifyCsrf(req)` and bail early if it returns non-null, BEFORE `requireOrgRole`.
- Middleware short-circuit checks use the exact convention `if (auth instanceof NextResponse) return auth;` — no cast, never `instanceof Response`.
- Route params are `ctx: { params: Promise<{...}> }`, awaited via `await ctx.params`.
- Responses use `NextResponse.json(...)` with an `x-request-id` header sourced from `reqCtx.requestId`.
- **Every DELETE route returns `NextResponse.json({ success: true }, { status: 200, headers: {...} })` — NEVER a bare `new NextResponse(null, { status: 204 })`.** This is not a style preference: `frontend/src/lib/api.ts` (protected, unmodifiable) unconditionally calls `response.json()` on every successful response, which throws a `SyntaxError` on an empty 204 body — silently miscast as a fake "Network error" by the same file's catch block, defeating any client-side success handling (`refresh()` never runs). This exact bug shipped in sub-project 2 and cost a full fix round; it must not happen again here.
- Every content page: destructure `notFound` from `useWorkspace()` and render the shared `WorkspaceNotFound` component (`@/components/workspace-not-found`) before the loading/error/data branches. Loading guard is `if (wsLoading || loading || !data)`. `error` from `useApi` is surfaced via `Alert variant="destructive"` + a "Réessayer" retry button (`window.location.reload()`), checked before the loading fallback.
- Any mutation that should update a page's list calls `refresh()` from `useApi` in its success path only (never in `catch`).
- Delete/edit affordances are gated client-side to `resource.authorId === user?.id || role === 'ADMIN' || role === 'OWNER'` from the start — checked via `useUser()` (from `@/contexts/AuthContext`) and `role` (from `useWorkspace()`), never added later as a review fix.
- On any mutation catch that surfaces an error to the user, branch on `err.code` (an `ApiError.code`, e.g. `'FORBIDDEN_NOT_OWNER'`) for a French message via a small local map; never render raw `err.message` from the server.
- `Project`/`Task`/`Organization`/`OrganizationMember`/`FileUpload`/`CalendarEvent`/`Document` are existing model names — do not rename them. New models `Message`/`Note` follow the same `String` (not Prisma enum) convention.
- Existing design system: `components/ui/*` (Button, Card, Badge, Input, Textarea, Label, Alert, Progress), lucide-react icons only (no emoji), indigo/slate palette.
- This codebase's convention for resolving a user's display name client-side is `member.name ?? member.email` (see `frontend/src/app/w/[orgSlug]/team/page.tsx:177` and `frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx:70,280`) — routes return raw ids (`authorId`, `assigneeId`, etc.), and pages resolve display names by cross-referencing a separately-fetched members list (`GET /api/organizations/[orgId]/members` → `{members: [{userId, email, name, role}]}`). Follow this exact pattern for `Message`/`Note` author display — do NOT resolve names server-side in these routes.

---

### Task 1: Add Message & Note Prisma models

**Files:**
- Modify: `frontend/prisma/schema.prisma`
- Create: migration via `pnpm db:migrate:dev --name add_message_note`

**Interfaces:**
- Produces: `prisma.message` and `prisma.note` Prisma Client delegates, consumed by every route task below.

- [ ] **Step 1: Add the two models to `frontend/prisma/schema.prisma`**

Add after the `Document` model:

```prisma
model Message {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId      String?
  project        Project?     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  authorId       String
  author         User         @relation("MessageAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  body           String
  createdAt      DateTime     @default(now())

  @@index([organizationId, projectId, createdAt])
}

model Note {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId      String?
  project        Project?     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  authorId       String
  author         User         @relation("NoteAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  title          String
  body           String
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId, projectId])
}
```

- [ ] **Step 2: Add back-relations on `Organization`, `Project`, and `User`**

On `Organization`, alongside the existing `calendarEvents`/`documents` relations, add:

```prisma
  messages Message[]
  notes    Note[]
```

On `Project`, alongside the existing `documents` relation, add:

```prisma
  messages Message[]
  notes    Note[]
```

On `User`, alongside the existing `calendarEventsCreated`/`documentsUploaded` relations, add:

```prisma
  messagesAuthored Message[] @relation("MessageAuthor")
  notesAuthored    Note[]    @relation("NoteAuthor")
```

- [ ] **Step 3: Run the migration**

Run: `cd frontend && pnpm db:migrate:dev --name add_message_note`
Expected: migration applies cleanly, no data loss (both are new tables). If
this fails with a shadow-database error, fall back to `pnpm db:push` plus
hand-authoring the migration SQL file under
`frontend/prisma/migrations/<timestamp>_add_message_note/migration.sql`
matching the two `CREATE TABLE` statements Prisma would have generated
(mirror the column types/constraints from the schema above) — this exact
fallback was used successfully in sub-project 2's Task 1.

- [ ] **Step 4: Verify the client generates correctly**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: no errors — confirms `prisma.message`/`prisma.note` delegates exist with the right shape.

- [ ] **Step 5: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations
git commit -m "feat(workspace): add Message and Note Prisma models"
```

---

### Task 2: Messages — create and list (no mentions yet)

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/messages/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/messages/route.test.ts`

**Interfaces:**
- Consumes: `prisma.message`, `prisma.project` (existing).
- Produces: `POST` → `{ message: { id, body, authorId, projectId, createdAt } }` (201). `GET ?projectId=...` → `{ messages: [{id, body, authorId, projectId, createdAt}] }` (200), oldest-to-newest, max 50. Consumed by Task 3 (adds mentions to this same file), Task 8 (messages page), Task 9 (project Discussions section).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/messages/route.test.ts`:

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
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj_1' } as never);
    prismaMock.message.create.mockResolvedValueOnce({
      id: 'msg_2',
      body: 'Point projet',
      authorId: 'u1',
      projectId: 'proj_1',
      createdAt: new Date('2026-10-01T10:05:00Z'),
    } as never);

    const res = await POST(
      makePost({ body: 'Point projet', projectId: 'proj_1' }),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(201);
    const responseBody = (await res.json()) as { message: { projectId: string } };
    expect(responseBody.message.projectId).toBe('proj_1');
  });

  it('returns 404 PROJECT_NOT_FOUND for a project in another org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      makePost({ body: 'Point projet', projectId: 'proj_foreign' }),
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

    await GET(makeGet('?projectId=proj_1'), ctxWith('org_1'));
    expect(prismaMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1', projectId: 'proj_1' } }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/messages/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/messages/route.ts`:

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
  body: z.string().trim().min(1).max(4000),
  projectId: zCuid.optional(),
});

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

    if (parsed.data.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: parsed.data.projectId, organizationId: orgId },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json(
          { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
    }

    const message = await prisma.message.create({
      data: {
        organizationId: orgId,
        projectId: parsed.data.projectId ?? null,
        authorId: auth.user.sub,
        body: parsed.data.body,
      },
      select: { id: true, body: true, authorId: true, projectId: true, createdAt: true },
    });

    return NextResponse.json(
      { message },
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

    const projectIdParam = new URL(req.url).searchParams.get('projectId');

    const rows = await prisma.message.findMany({
      where: { organizationId: orgId, projectId: projectIdParam ?? null },
      select: { id: true, body: true, authorId: true, projectId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const messages = rows.reverse();

    return NextResponse.json(
      { messages },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/messages/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/messages"
git commit -m "feat(workspace): add messages create/list route"
```

---

### Task 3: Mentions — extend the messages route to extract, validate, and notify

**Files:**
- Modify: `frontend/src/app/api/organizations/[orgId]/messages/route.ts` (POST handler only)
- Modify: `frontend/src/app/api/organizations/[orgId]/messages/route.test.ts` (add mention tests)

**Interfaces:**
- Consumes: `isOrgMember` (`@/lib/server/organizations/guards`, existing — signature `isOrgMember(client, organizationId, userId): Promise<boolean>`), `createNotification` (`@/lib/server/notifications`, existing), `mentionNotification` (new, added to `@/lib/server/notifications/templates.ts` in this task).
- Produces: nothing new consumed by later tasks — mentions are entirely server-side; the client (Task 8/9) only needs to know the compose textarea inserts `@[Name](userId)` tokens, which this task's regex extracts.

- [ ] **Step 1: Add a `mentionNotification` template**

Append to `frontend/src/lib/server/notifications/templates.ts`:

```ts
/**
 * Fired when a user is @mentioned in a Message. dedupeKey is deterministic
 * per (message, mentioned user) pair so re-processing the same message never
 * double-fires.
 */
export function mentionNotification(
  mentionedUserId: string,
  messageId: string,
  authorName: string,
  organizationId: string,
  projectId: string | null,
): CreateNotificationInput {
  return {
    userId: mentionedUserId,
    type: 'MENTION',
    title: 'Vous avez été mentionné',
    body: `${authorName} vous a mentionné dans un message.`,
    data: { messageId, organizationId, projectId },
    dedupeKey: `mention:${messageId}:${mentionedUserId}`,
  };
}
```

- [ ] **Step 2: Add the failing mention tests**

Append to `frontend/src/app/api/organizations/[orgId]/messages/route.test.ts`. First, update the mock block at the top of the file — change:

```ts
vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));
```

to:

```ts
vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));
vi.mock('@/lib/server/organizations/guards', () => ({ isOrgMember: vi.fn() }));
vi.mock('@/lib/server/notifications', () => ({ createNotification: vi.fn() }));
```

and change the import line:

```ts
import { requireOrgRole } from '@/lib/server/middleware';
import { POST, GET } from './route';
```

to:

```ts
import { requireOrgRole } from '@/lib/server/middleware';
import { isOrgMember } from '@/lib/server/organizations/guards';
import { createNotification } from '@/lib/server/notifications';
import { POST, GET } from './route';

const mockIsOrgMember = vi.mocked(isOrgMember);
const mockCreateNotification = vi.mocked(createNotification);
```

Then, inside the `beforeEach`, add a default:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
  mockIsOrgMember.mockResolvedValue(true);
  mockCreateNotification.mockResolvedValue(null);
});
```

Finally, append a new `describe` block at the end of the file:

```ts
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
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/messages/route.test.ts"`
Expected: the 4 new tests FAIL (mention extraction doesn't exist yet); the Task 2 tests still PASS.

- [ ] **Step 4: Implement mention extraction + notification firing**

Modify `frontend/src/app/api/organizations/[orgId]/messages/route.ts`. Change the import block at the top from:

```ts
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zCuid } from '@/lib/server/zod-helpers';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
```

to:

```ts
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zCuid } from '@/lib/server/zod-helpers';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { isOrgMember } from '@/lib/server/organizations/guards';
import { createNotification } from '@/lib/server/notifications';
import { mentionNotification } from '@/lib/server/notifications/templates';
import { log } from '@/lib/server/observability/log';
```

Add this helper function above `export async function POST`:

```ts
const MENTION_TOKEN = /@\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g;

function extractMentionedUserIds(body: string): { name: string; userId: string }[] {
  const matches = [...body.matchAll(MENTION_TOKEN)];
  return matches.map((m) => ({ name: m[1]!, userId: m[2]! }));
}
```

Then, inside `POST`, replace the block:

```ts
    const message = await prisma.message.create({
      data: {
        organizationId: orgId,
        projectId: parsed.data.projectId ?? null,
        authorId: auth.user.sub,
        body: parsed.data.body,
      },
      select: { id: true, body: true, authorId: true, projectId: true, createdAt: true },
    });

    return NextResponse.json(
      { message },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
```

with:

```ts
    const message = await prisma.message.create({
      data: {
        organizationId: orgId,
        projectId: parsed.data.projectId ?? null,
        authorId: auth.user.sub,
        body: parsed.data.body,
      },
      select: { id: true, body: true, authorId: true, projectId: true, createdAt: true },
    });

    const mentions = extractMentionedUserIds(parsed.data.body);
    for (const mention of mentions) {
      const stillMember = await isOrgMember(prisma, orgId, mention.userId);
      if (!stillMember) continue;
      try {
        await createNotification(
          prisma,
          mentionNotification(mention.userId, message.id, mention.name, orgId, message.projectId),
        );
      } catch (err) {
        log.warn('mention notification failed, message still created', {
          err,
          messageId: message.id,
          mentionedUserId: mention.userId,
        });
      }
    }

    return NextResponse.json(
      { message },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/messages/route.test.ts"`
Expected: PASS (all tests from Tasks 2 and 3).

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/messages" frontend/src/lib/server/notifications/templates.ts
git commit -m "feat(workspace): fire mention notifications from message creation"
```

---

### Task 4: Notes — create and list

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/notes/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/notes/route.test.ts`

**Interfaces:**
- Consumes: `prisma.note`, `prisma.project` (existing).
- Produces: `POST` → `{ note: { id, title, body, authorId, projectId, createdAt, updatedAt } }` (201). `GET` → `{ notes: [{id, title, body, authorId, projectId, project: {id, name} | null, createdAt, updatedAt}] }` (200), newest first. Consumed by Task 5 (PATCH/DELETE), Task 10 (notes page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/notes/route.test.ts`:

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
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj_1' } as never);
    prismaMock.note.create.mockResolvedValueOnce({
      id: 'note_2',
      title: 'Idée projet',
      body: 'Contenu',
      authorId: 'u1',
      projectId: 'proj_1',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      updatedAt: new Date('2026-10-01T10:00:00Z'),
    } as never);

    const res = await POST(
      makePost({ title: 'Idée projet', body: 'Contenu', projectId: 'proj_1' }),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(201);
  });

  it('returns 404 PROJECT_NOT_FOUND for a foreign project', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      makePost({ title: 'x', body: 'y', projectId: 'proj_foreign' }),
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
        projectId: 'proj_1',
        project: { id: 'proj_1', name: 'Site web' },
        createdAt: new Date('2026-10-01T10:00:00Z'),
        updatedAt: new Date('2026-10-01T10:00:00Z'),
      },
    ] as never);

    const res = await GET(new NextRequest('http://test/api/organizations/org_1/notes'), ctxWith('org_1'));
    expect(res.status).toBe(200);
    const responseBody = (await res.json()) as { notes: { project: { name: string } }[] };
    expect(responseBody.notes[0]!.project.name).toBe('Site web');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/notes/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/notes/route.ts`:

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
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(20000),
  projectId: zCuid.optional(),
});

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

    if (parsed.data.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: parsed.data.projectId, organizationId: orgId },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json(
          { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
    }

    const note = await prisma.note.create({
      data: {
        organizationId: orgId,
        projectId: parsed.data.projectId ?? null,
        authorId: auth.user.sub,
        title: parsed.data.title,
        body: parsed.data.body,
      },
      select: {
        id: true,
        title: true,
        body: true,
        authorId: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { note },
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

    const notes = await prisma.note.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        title: true,
        body: true,
        authorId: true,
        projectId: true,
        project: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(
      { notes },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/notes/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/notes"
git commit -m "feat(workspace): add notes create/list route"
```

---

### Task 5: Notes — update and delete

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/notes/[noteId]/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/notes/[noteId]/route.test.ts`

**Interfaces:**
- Consumes: `prisma.note` (Task 4).
- Produces: `PATCH` → `{ note: {...} }` (200), or 403 `FORBIDDEN_NOT_OWNER` / 404 `NOTE_NOT_FOUND`. `DELETE` → `{ success: true }` (200 — NOT 204, see Global Constraints), or 403/404 as above. Consumed by Task 10 (notes page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/notes/[noteId]/route.test.ts`:

```ts
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

function ctxWith(orgId: string, noteId: string): { params: Promise<{ orgId: string; noteId: string }> } {
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/notes/[noteId]/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/notes/[noteId]/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const PatchBody = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
});

async function loadNoteOr404(
  orgId: string,
  noteId: string,
  requestId: string,
): Promise<{ id: string; organizationId: string; authorId: string } | NextResponse> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, organizationId: true, authorId: true },
  });
  if (!note || note.organizationId !== orgId) {
    return NextResponse.json(
      { error: 'NOTE_NOT_FOUND', message: 'Note not found' },
      { status: 404, headers: { 'x-request-id': requestId } },
    );
  }
  return note;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; noteId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, noteId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const note = await loadNoteOr404(orgId, noteId, reqCtx.requestId);
    if (note instanceof NextResponse) return note;

    const isAuthor = note.authorId === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isAuthor && !isAdminOrOwner) {
      return NextResponse.json(
        { error: 'FORBIDDEN_NOT_OWNER', message: 'Only the author or an admin can edit this note' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.note.update({
      where: { id: noteId },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      },
      select: {
        id: true,
        title: true,
        body: true,
        authorId: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { note: updated },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; noteId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, noteId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const note = await loadNoteOr404(orgId, noteId, reqCtx.requestId);
    if (note instanceof NextResponse) return note;

    const isAuthor = note.authorId === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isAuthor && !isAdminOrOwner) {
      return NextResponse.json(
        { error: 'FORBIDDEN_NOT_OWNER', message: 'Only the author or an admin can delete this note' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await prisma.note.delete({ where: { id: noteId } });

    return NextResponse.json(
      { success: true },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/notes/[noteId]/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/notes/[noteId]"
git commit -m "feat(workspace): add note update/delete route with author-or-admin guard"
```

---

### Task 6: Notifications route — add a `type` filter

**Files:**
- Modify: `frontend/src/app/api/notifications/route.ts` (GET handler only)
- Modify: `frontend/src/app/api/notifications/route.test.ts` (add filter tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET ?type=MENTION` filters the existing list to that type. Fully backward compatible — omitting `type` behaves exactly as before. Consumed by Task 11 (mentions page) and Task 12 (notifications page, which omits the filter).

- [ ] **Step 1: Read the existing route and test file first**

Read `frontend/src/app/api/notifications/route.ts` and
`frontend/src/app/api/notifications/route.test.ts` in full before editing —
this task adds one query param to an existing, already-tested `GET`
handler. Do not change the `PATCH` handler, `serialize`, or `clampLimit` in
this file.

- [ ] **Step 2: Add the failing filter test**

The file already has a top-level `beforeEach` (around line 75) that calls
`mockRequireAuth.mockResolvedValue(authedCtx)` for every test — do not
duplicate that setup. Append this `it` block inside the existing
`describe('GET /api/notifications', ...)` block, matching the file's own
established idiom for inspecting the `where` clause passed to
`prismaMock.notification.findMany` (see the existing "Test 5: ?unread=true
adds readAt:null to where" test for the exact pattern to copy):

```ts
  it('filters by type when a type query param is given', async () => {
    prismaMock.notification.findMany.mockResolvedValue([] as never);
    await GET(makeGet('http://test/api/notifications?type=MENTION'));
    const args = prismaMock.notification.findMany.mock.calls[0]?.[0];
    expect(args?.where?.type).toBe('MENTION');
  });
```

- [ ] **Step 3: Run the tests to verify the new one fails**

Run: `cd frontend && pnpm exec vitest run src/app/api/notifications/route.test.ts`
Expected: the new test FAILS (no `type` filter yet); all existing tests still PASS.

- [ ] **Step 4: Add the filter**

In `frontend/src/app/api/notifications/route.ts`'s `GET` handler, find this
block:

```ts
    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const unread = url.searchParams.get('unread') === 'true';
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.NotificationWhereInput = {
      userId: auth.user.sub,
      ...(unread ? { readAt: null } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
```

Replace with:

```ts
    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const unread = url.searchParams.get('unread') === 'true';
    const type = url.searchParams.get('type');
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.NotificationWhereInput = {
      userId: auth.user.sub,
      ...(unread ? { readAt: null } : {}),
      ...(type ? { type } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
```

Do not touch any other line in this file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run src/app/api/notifications/route.test.ts`
Expected: PASS (all existing tests plus the new one).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/notifications/route.ts frontend/src/app/api/notifications/route.test.ts
git commit -m "feat(notifications): add optional type filter to the list route"
```

---

### Task 7: Activity feed route

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/activity/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/activity/route.test.ts`

**Interfaces:**
- Consumes: `prisma.project`, `prisma.task`, `prisma.calendarEvent`, `prisma.document`, `prisma.message`, `prisma.note`, `prisma.organizationMember` (all existing by this point in the plan).
- Produces: `GET` → `{ activity: [{id, type, actorName, description, createdAt}] }` (200), top 30 by `createdAt` descending across all seven sources. Consumed by Task 13 (activity page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/activity/route.test.ts`:

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
    const res = await GET(new NextRequest('http://test/api/organizations/org_1/activity'), ctxWith('org_1'));
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

    const res = await GET(new NextRequest('http://test/api/organizations/org_1/activity'), ctxWith('org_1'));
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

    const res = await GET(new NextRequest('http://test/api/organizations/org_1/activity'), ctxWith('org_1'));
    const body = (await res.json()) as { activity: unknown[] };
    expect(body.activity).toHaveLength(30);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/activity/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/activity/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface ActivityEntry {
  id: string;
  type: 'project' | 'task' | 'calendar_event' | 'document' | 'message' | 'note' | 'member';
  actorName: string;
  description: string;
  createdAt: Date;
}

function displayName(actor: { name: string | null; email: string }): string {
  return actor.name ?? actor.email;
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

    const [projects, tasks, calendarEvents, documents, messages, notes, members] = await Promise.all([
      prisma.project.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.task.findMany({
        where: { organizationId: orgId },
        select: { id: true, title: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.calendarEvent.findMany({
        where: { organizationId: orgId },
        select: { id: true, title: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.document.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          createdAt: true,
          uploadedBy: { select: { name: true, email: true } },
          fileUpload: { select: { filename: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.message.findMany({
        where: { organizationId: orgId },
        select: { id: true, createdAt: true, author: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.note.findMany({
        where: { organizationId: orgId },
        select: { id: true, title: true, createdAt: true, author: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.organizationMember.findMany({
        where: { organizationId: orgId },
        select: { id: true, createdAt: true, user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const entries: ActivityEntry[] = [
      ...projects.map((p) => ({
        id: `project:${p.id}`,
        type: 'project' as const,
        actorName: displayName(p.createdBy),
        description: `a créé le projet « ${p.name} »`,
        createdAt: p.createdAt,
      })),
      ...tasks.map((t) => ({
        id: `task:${t.id}`,
        type: 'task' as const,
        actorName: displayName(t.createdBy),
        description: `a créé la tâche « ${t.title} »`,
        createdAt: t.createdAt,
      })),
      ...calendarEvents.map((e) => ({
        id: `calendar_event:${e.id}`,
        type: 'calendar_event' as const,
        actorName: displayName(e.createdBy),
        description: `a ajouté l'événement « ${e.title} » au calendrier`,
        createdAt: e.createdAt,
      })),
      ...documents.map((d) => ({
        id: `document:${d.id}`,
        type: 'document' as const,
        actorName: displayName(d.uploadedBy),
        description: `a ajouté le fichier « ${d.fileUpload.filename} »`,
        createdAt: d.createdAt,
      })),
      ...messages.map((m) => ({
        id: `message:${m.id}`,
        type: 'message' as const,
        actorName: displayName(m.author),
        description: 'a posté un message',
        createdAt: m.createdAt,
      })),
      ...notes.map((n) => ({
        id: `note:${n.id}`,
        type: 'note' as const,
        actorName: displayName(n.author),
        description: `a créé la note « ${n.title} »`,
        createdAt: n.createdAt,
      })),
      ...members.map((m) => ({
        id: `member:${m.id}`,
        type: 'member' as const,
        actorName: displayName(m.user),
        description: 'a rejoint l’équipe',
        createdAt: m.createdAt,
      })),
    ];

    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return NextResponse.json(
      { activity: entries.slice(0, 30) },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/activity/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/activity"
git commit -m "feat(workspace): add read-only recent-activity feed route"
```

---

### Task 8: Messages page + shared mention-picker component

**Files:**
- Create: `frontend/src/components/mention-input.tsx`
- Create: `frontend/src/app/w/[orgSlug]/messages/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `useApi`, `api`/`ApiError`, `GET /api/organizations/[orgId]/members` (existing, `{members: [{userId,email,name,role}]}`), `POST`/`GET /api/organizations/[orgId]/messages` (Tasks 2-3).
- Produces: `MentionInput` component — `{ value: string; onChange: (v: string) => void; members: {userId:string; email:string; name:string|null}[]; placeholder?: string }` — consumed by Task 9 (project Discussions section).

- [ ] **Step 1: Implement the shared `MentionInput` component**

Create `frontend/src/components/mention-input.tsx`:

```tsx
'use client';

import { useState, useRef, type ChangeEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';

interface MemberOption {
  userId: string;
  email: string;
  name: string | null;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  members: MemberOption[];
  placeholder?: string;
}

/**
 * A plain textarea that opens a member picker when the user types "@".
 * Selecting a member inserts a `@[Display Name](userId)` token into the
 * text — the server-side mention regex in the messages route matches this
 * exact shape. Rendering (replacing the token with a styled span) is done
 * by `renderMessageBody` below, used wherever a message/note body is
 * displayed.
 */
export function MentionInput({ value, onChange, members, placeholder }: MentionInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function onTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    const cursor = e.target.selectionStart;
    const uptoCursor = next.slice(0, cursor);
    const atMatch = /@([a-zA-Z0-9À-ſ ]{0,30})$/.exec(uptoCursor);
    if (atMatch) {
      setFilter(atMatch[1]!.toLowerCase());
      setPickerOpen(true);
    } else {
      setPickerOpen(false);
    }
  }

  function insertMention(member: MemberOption) {
    const label = member.name ?? member.email;
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf('@');
    const before = value.slice(0, atIndex >= 0 ? atIndex : cursor);
    const after = value.slice(cursor);
    const token = `@[${label}](${member.userId})`;
    onChange(`${before}${token} ${after}`);
    setPickerOpen(false);
  }

  const filtered = members.filter((m) =>
    (m.name ?? m.email).toLowerCase().includes(filter),
  );

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={onTextChange}
        placeholder={placeholder}
        rows={3}
      />
      {pickerOpen && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-md">
          {filtered.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => insertMention(m)}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {m.name ?? m.email}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MENTION_TOKEN = /@\[([^\]]+)\]\([a-zA-Z0-9]+\)/g;

/** Replaces every `@[Name](id)` token in a message/note body with `@Name`, for display. */
export function renderMessageBody(body: string): string {
  return body.replace(MENTION_TOKEN, '@$1');
}
```

- [ ] **Step 2: Implement the messages page**

Create `frontend/src/app/w/[orgSlug]/messages/page.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { MessageSquare } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { MentionInput, renderMessageBody } from '@/components/mention-input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface MessageRow {
  id: string;
  body: string;
  authorId: string;
  projectId: string | null;
  createdAt: string;
}

interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

export default function MessagesPage() {
  const { organizationId, loading: wsLoading, notFound } = useWorkspace();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const messagesPath = organizationId ? `/api/organizations/${organizationId}/messages` : '';
  const { data, loading, error, refresh } = useApi<{ messages: MessageRow[] }>(messagesPath, {
    skip: !organizationId,
  });

  const membersPath = organizationId ? `/api/organizations/${organizationId}/members` : '';
  const { data: membersData } = useApi<{ members: MemberRow[] }>(membersPath, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les messages.</AlertDescription>
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

  function resolveName(userId: string): string {
    const match = membersData?.members.find((m) => m.userId === userId);
    return match ? (match.name ?? match.email) : 'Membre inconnu';
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    setSendError(null);
    if (!draft.trim()) return;
    setSending(true);
    try {
      await api(`/api/organizations/${organizationId}/messages`, {
        method: 'POST',
        body: { body: draft.trim() },
      });
      setDraft('');
      await refresh();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Messagerie</h1>
      </header>

      <div className="mb-4 flex flex-1 flex-col gap-3 overflow-y-auto">
        {data.messages.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun message pour l&apos;instant.</p>
        ) : (
          data.messages.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">{resolveName(m.authorId)}</span>
                <span className="text-xs text-slate-400">
                  {new Date(m.createdAt).toLocaleString('fr-FR')}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{renderMessageBody(m.body)}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSend} className="flex flex-col gap-2">
        <MentionInput
          value={draft}
          onChange={setDraft}
          members={membersData?.members ?? []}
          placeholder="Écrivez un message… (@ pour mentionner)"
        />
        {sendError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{sendError}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={sending} className="self-end">
          {sending ? 'Envoi…' : 'Envoyer'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Run the full validation gate**

Run: `cd frontend && pnpm exec prettier --write frontend/src/components/mention-input.tsx "frontend/src/app/w/[orgSlug]/messages/page.tsx" && pnpm exec eslint frontend/src/components/mention-input.tsx "frontend/src/app/w/[orgSlug]/messages/page.tsx" && pnpm exec tsc --noEmit && pnpm test`

(adjust prettier/eslint paths to be relative to `frontend/` if running from that directory — e.g. `src/components/mention-input.tsx`)

Expected: all pass. Client pages have no dedicated Vitest suite in this codebase (existing precedent).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/mention-input.tsx "frontend/src/app/w/[orgSlug]/messages"
git commit -m "feat(workspace): add messages page with mention picker"
```

---

### Task 9: Discussions section on the project detail page

**Files:**
- Modify: `frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx`

**Interfaces:**
- Consumes: `MentionInput`, `renderMessageBody` (Task 8), `POST`/`GET /api/organizations/[orgId]/messages?projectId=...` (Tasks 2-3), `GET /api/organizations/[orgId]/members` (existing, already fetched by this page for the assignee `<select>` per sub-project 1).

- [ ] **Step 1: Read the existing file first**

Read `frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx` in full
before editing — this task ADDS a section, it does not rewrite the page.
By this point in the plan the file already has a Documents section (added
in sub-project 2). Its actual current helper for resolving a member's
display name is a module-level function `memberLabel(members: Member[],
userId: string): string` (NOT a hook, takes the members array as its first
argument) — reuse it exactly as-is, do not introduce a second,
differently-named copy. The page already fetches the org's members list
into a local `const members = membersData?.members ?? [];` for the
assignee `<select>` — reuse that same array for the mention picker rather
than fetching it twice. The project id is read via
`const params = useParams<{ projectId: string }>();` and used as
`params.projectId` throughout the file (there is no bare `projectId`
variable) — use `params.projectId` in this task's new code too.

- [ ] **Step 2: Add message state, handlers, and a Discussions section**

Add this interface near the file's other interfaces:

```tsx
interface ProjectMessageRow {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
}
```

Add an import for the mention helpers — merge into the file's existing
import block:

```tsx
import { MentionInput, renderMessageBody } from '@/components/mention-input';
```

Inside the page component, alongside the existing `useApi` calls, add:

```tsx
const messagesPath = organizationId
  ? `/api/organizations/${organizationId}/messages?projectId=${params.projectId}`
  : '';
const {
  data: messagesData,
  refresh: refreshMessages,
} = useApi<{ messages: ProjectMessageRow[] }>(messagesPath, { skip: !organizationId });

const [messageDraft, setMessageDraft] = useState('');
const [messageSendError, setMessageSendError] = useState<string | null>(null);
const [sendingMessage, setSendingMessage] = useState(false);
```

Add the send handler:

```tsx
async function onSendMessage() {
  setMessageSendError(null);
  if (!messageDraft.trim()) return;
  setSendingMessage(true);
  try {
    await api(`/api/organizations/${organizationId}/messages`, {
      method: 'POST',
      body: { body: messageDraft.trim(), projectId: params.projectId },
    });
    setMessageDraft('');
    await refreshMessages();
  } catch (err) {
    setMessageSendError(err instanceof ApiError ? err.message : 'Erreur réseau.');
  } finally {
    setSendingMessage(false);
  }
}
```

Add the Discussions section to the page's JSX, after the Documents section
added in sub-project 2:

```tsx
<section className="mt-8">
  <h2 className="mb-3 text-lg font-semibold text-slate-900">Discussions</h2>
  <div className="mb-3 flex flex-col gap-2">
    {(messagesData?.messages.length ?? 0) === 0 ? (
      <p className="text-sm text-slate-500">Aucun message pour l&apos;instant.</p>
    ) : (
      messagesData?.messages.map((m) => (
        <div key={m.id} className="rounded-lg border border-slate-200 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-900">{memberLabel(members, m.authorId)}</span>
            <span className="text-xs text-slate-400">
              {new Date(m.createdAt).toLocaleString('fr-FR')}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{renderMessageBody(m.body)}</p>
        </div>
      ))
    )}
  </div>
  <MentionInput
    value={messageDraft}
    onChange={setMessageDraft}
    members={members}
    placeholder="Discuter de ce projet… (@ pour mentionner)"
  />
  {messageSendError && (
    <Alert variant="destructive" role="alert" className="mt-2">
      <AlertDescription>{messageSendError}</AlertDescription>
    </Alert>
  )}
  <Button type="button" onClick={onSendMessage} disabled={sendingMessage} className="mt-2">
    {sendingMessage ? 'Envoi…' : 'Envoyer'}
  </Button>
</section>
```

- [ ] **Step 3: Run the full validation gate**

Run: `cd frontend && pnpm exec prettier --write "src/app/w/[orgSlug]/projects/[projectId]/page.tsx" && pnpm exec eslint "src/app/w/[orgSlug]/projects/[projectId]/page.tsx" && pnpm exec tsc --noEmit && pnpm test`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx"
git commit -m "feat(workspace): add Discussions section to project detail page"
```

---

### Task 10: Notes page

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/notes/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `useUser()` (`@/contexts/AuthContext`), `useApi`, `api`/`ApiError`, `POST`/`GET /api/organizations/[orgId]/notes` (Task 4), `PATCH`/`DELETE /api/organizations/[orgId]/notes/[noteId]` (Task 5).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/notes/page.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { StickyNote, Pencil, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useUser } from '@/contexts/AuthContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface NoteRow {
  id: string;
  title: string;
  body: string;
  authorId: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'FORBIDDEN_NOT_OWNER') {
    return 'Seul l’auteur ou un administrateur peut modifier cette note.';
  }
  return 'Erreur réseau.';
}

export default function NotesPage() {
  const { organizationId, role, loading: wsLoading, notFound } = useWorkspace();
  const user = useUser();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  const notesPath = organizationId ? `/api/organizations/${organizationId}/notes` : '';
  const { data, loading, error, refresh } = useApi<{ notes: NoteRow[] }>(notesPath, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les notes.</AlertDescription>
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

  function canEdit(note: NoteRow): boolean {
    return note.authorId === user?.id || role === 'ADMIN' || role === 'OWNER';
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim() || !body.trim()) {
      setFormError('Le titre et le contenu sont obligatoires.');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/organizations/${organizationId}/notes`, {
        method: 'POST',
        body: { title: title.trim(), body: body.trim() },
      });
      setTitle('');
      setBody('');
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(note: NoteRow) {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditBody(note.body);
    setMutationError(null);
  }

  async function onSaveEdit(noteId: string) {
    try {
      await api(`/api/organizations/${organizationId}/notes/${noteId}`, {
        method: 'PATCH',
        body: { title: editTitle.trim(), body: editBody.trim() },
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setMutationError(errorMessage(err));
    }
  }

  async function onDelete(noteId: string) {
    setMutationError(null);
    try {
      await api(`/api/organizations/${organizationId}/notes/${noteId}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setMutationError(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <StickyNote className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Notes</h1>
      </header>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={onCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note-title">Titre</Label>
              <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note-body">Contenu</Label>
              <Textarea id="note-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            {formError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="self-end">
              {submitting ? 'Ajout…' : 'Ajouter la note'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {mutationError && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      )}

      {data.notes.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune note pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.notes.map((note) => (
            <Card key={note.id}>
              <CardContent className="pt-4">
                {editingId === note.id ? (
                  <div className="flex flex-col gap-2">
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    <Textarea rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => onSaveEdit(note.id)}>
                        Enregistrer
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h3 className="font-medium text-slate-900">{note.title}</h3>
                      {canEdit(note) && (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(note)}
                            className="text-slate-400 hover:text-indigo-600"
                            aria-label={`Modifier ${note.title}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(note.id)}
                            className="text-slate-400 hover:text-red-600"
                            aria-label={`Supprimer ${note.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
                    {note.project && (
                      <span className="mt-2 inline-block text-xs text-indigo-600">{note.project.name}</span>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify `useUser` doesn't force a redirect on this page**

Read `frontend/src/contexts/AuthContext.tsx`'s `useUser` signature before
running the gate — it takes an optional `redirectTo` param defaulting to
`/login`. Since this page only renders inside the authenticated
`/w/[orgSlug]/*` layout, calling `useUser()` with no arguments is safe and
matches existing usage (e.g. `frontend/src/app/settings/page.tsx`).

- [ ] **Step 3: Run the full validation gate**

Run: `cd frontend && pnpm exec prettier --write "src/app/w/[orgSlug]/notes/page.tsx" && pnpm exec eslint "src/app/w/[orgSlug]/notes/page.tsx" && pnpm exec tsc --noEmit && pnpm test`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/notes"
git commit -m "feat(workspace): add notes page with author-or-admin edit/delete gating"
```

---

### Task 11: Mentions page

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/mentions/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `useApi`, `api`, `GET /api/notifications?type=MENTION` (Task 6), `PATCH /api/notifications` (existing).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/mentions/page.tsx`:

```tsx
'use client';

import { AtSign } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface MentionNotification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function MentionsPage() {
  const { loading: wsLoading, notFound } = useWorkspace();
  const { data, loading, error, refresh } = useApi<{ items: MentionNotification[] }>(
    '/api/notifications?type=MENTION',
  );

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les mentions.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  async function markRead(id: string) {
    try {
      await api('/api/notifications', { method: 'PATCH', body: { ids: [id] } });
      await refresh();
    } catch {
      // best-effort; the item just stays marked unread until the next successful attempt
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <AtSign className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Mentions</h1>
      </header>

      {data.items.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune mention pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-start justify-between gap-3 pt-4">
                <div>
                  <p className="text-sm text-slate-900">{item.body}</p>
                  <span className="text-xs text-slate-400">
                    {new Date(item.createdAt).toLocaleString('fr-FR')}
                  </span>
                </div>
                {item.readAt === null ? (
                  <button
                    type="button"
                    onClick={() => markRead(item.id)}
                    className="shrink-0 text-xs text-indigo-600 hover:underline"
                  >
                    Marquer comme lu
                  </button>
                ) : (
                  <Badge variant="outline" className="shrink-0">
                    Lu
                  </Badge>
                )}
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

Run: `cd frontend && pnpm exec prettier --write "src/app/w/[orgSlug]/mentions/page.tsx" && pnpm exec eslint "src/app/w/[orgSlug]/mentions/page.tsx" && pnpm exec tsc --noEmit && pnpm test`

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/mentions"
git commit -m "feat(workspace): add mentions page"
```

---

### Task 12: Notifications page + bell badge in the sidebar

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/notifications/page.tsx`
- Modify: `frontend/src/app/w/[orgSlug]/layout.tsx`

**Interfaces:**
- Consumes: `useApi`, `api`, `GET /api/notifications` (existing, no filter), `PATCH /api/notifications` (existing), `GET /api/notifications/count` (existing — confirmed response shape is `{ count: number }`, per `frontend/src/app/api/notifications/count/route.ts`).

- [ ] **Step 1: Implement the notifications page**

Create `frontend/src/app/w/[orgSlug]/notifications/page.tsx`:

```tsx
'use client';

import { Bell } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const { loading: wsLoading, notFound } = useWorkspace();
  const { data, loading, error, refresh } = useApi<{ items: NotificationItem[] }>('/api/notifications');

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les notifications.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  async function markRead(id: string) {
    try {
      await api('/api/notifications', { method: 'PATCH', body: { ids: [id] } });
      await refresh();
    } catch {
      // best-effort
    }
  }

  async function markAllRead() {
    try {
      await api('/api/notifications', { method: 'PATCH', body: { ids: 'all' } });
      await refresh();
    } catch {
      // best-effort
    }
  }

  const hasUnread = data.items.some((item) => item.readAt === null);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-indigo-600" />
          <h1 className="text-xl font-semibold text-slate-900">Notifications</h1>
        </div>
        {hasUnread && (
          <Button type="button" variant="outline" size="sm" onClick={markAllRead}>
            Tout marquer comme lu
          </Button>
        )}
      </header>

      {data.items.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune notification pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-start justify-between gap-3 pt-4">
                <div>
                  <h3 className="text-sm font-medium text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-700">{item.body}</p>
                  <span className="text-xs text-slate-400">
                    {new Date(item.createdAt).toLocaleString('fr-FR')}
                  </span>
                </div>
                {item.readAt === null ? (
                  <button
                    type="button"
                    onClick={() => markRead(item.id)}
                    className="shrink-0 text-xs text-indigo-600 hover:underline"
                  >
                    Marquer comme lu
                  </button>
                ) : (
                  <Badge variant="outline" className="shrink-0">
                    Lu
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add a notification bell with an unread badge to the sidebar**

Read `frontend/src/app/w/[orgSlug]/layout.tsx` in full before editing (this
file also gets its Task 14 nav-item/section-header changes in this same
plan — if Task 14 runs after this task, its edits land on top of this
one; if you are implementing this task and Task 14 hasn't run yet, that's
fine, just don't remove anything Task 14's own instructions will add
later).

Add `Bell` to the existing lucide-react import line. Add
`import Link from 'next/link';` if not already imported (it already is, per
the workspace-switcher links). Add this import:

```tsx
import { useApi } from '@/lib/useApi';
```

Inside the `Sidebar` function component, alongside its existing
`useWorkspace()` call, add:

```tsx
const { data: notifCount } = useApi<{ count: number }>('/api/notifications/count');
```

In the JSX, inside the top workspace-switcher `<div className="relative border-b ...">` block, add a bell link as a sibling of the switcher `<button>`, so the block reads:

```tsx
<div className="relative flex items-center justify-between border-b border-slate-200 p-4">
  <button
    type="button"
    onClick={() => setSwitcherOpen((o) => !o)}
    className="flex min-w-0 flex-1 cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
  >
    <span className="truncate">{loading ? 'Chargement…' : name || 'Espace de travail'}</span>
    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
  </button>
  <Link
    href={`/w/${slug}/notifications`}
    className="relative ml-2 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"
    aria-label="Notifications"
  >
    <Bell className="h-4 w-4" />
    {(notifCount?.count ?? 0) > 0 && (
      <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-semibold text-white">
        {notifCount!.count > 9 ? '9+' : notifCount!.count}
      </span>
    )}
  </Link>
</div>
```

This replaces the existing `<div className="relative border-b border-slate-200 p-4">...</div>` block — keep the `switcherOpen` dropdown `<div>` that follows it (the one rendering `organizations.map(...)`) exactly as it is, just make sure it's still a sibling inside the same outer wrapping structure so the dropdown still positions correctly (it's `absolute`-positioned relative to the outer container, which still has `relative` on it).

- [ ] **Step 3: Run the full validation gate**

Run: `cd frontend && pnpm exec prettier --write "src/app/w/[orgSlug]/notifications/page.tsx" "src/app/w/[orgSlug]/layout.tsx" && pnpm exec eslint "src/app/w/[orgSlug]/notifications/page.tsx" "src/app/w/[orgSlug]/layout.tsx" && pnpm exec tsc --noEmit && pnpm test`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/notifications" "frontend/src/app/w/[orgSlug]/layout.tsx"
git commit -m "feat(workspace): add notifications page and sidebar bell badge"
```

---

### Task 13: Activity page

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/activity/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `useApi`, `GET /api/organizations/[orgId]/activity` (Task 7).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/activity/page.tsx`:

```tsx
'use client';

import { Activity as ActivityIcon } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ActivityEntry {
  id: string;
  type: string;
  actorName: string;
  description: string;
  createdAt: string;
}

export default function ActivityPage() {
  const { organizationId, loading: wsLoading, notFound } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/activity` : '';
  const { data, loading, error } = useApi<{ activity: ActivityEntry[] }>(path, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger l&apos;activité récente.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <ActivityIcon className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Activité récente</h1>
      </header>

      {data.activity.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune activité pour l&apos;instant.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.activity.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <span className="font-medium text-slate-900">{entry.actorName}</span>{' '}
              {entry.description}
              <span className="ml-2 text-xs text-slate-400">
                {new Date(entry.createdAt).toLocaleString('fr-FR')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the full validation gate**

Run: `cd frontend && pnpm exec prettier --write "src/app/w/[orgSlug]/activity/page.tsx" && pnpm exec eslint "src/app/w/[orgSlug]/activity/page.tsx" && pnpm exec tsc --noEmit && pnpm test`

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/activity"
git commit -m "feat(workspace): add recent activity page"
```

---

### Task 14: Sidebar — section headers + new nav items

**Files:**
- Modify: `frontend/src/app/w/[orgSlug]/layout.tsx`

**Interfaces:**
- None new — purely a nav-list restructure.

- [ ] **Step 1: Read the existing file first**

Read `frontend/src/app/w/[orgSlug]/layout.tsx` in full before editing. By
this point in the plan it already has the Task 12 bell-badge changes (if
that task ran first) — do not remove or alter them. The nav rendering
currently maps one flat `NAV_ITEMS` array under a single "Espace de
travail" header (see the `<p className="... uppercase">Espace de
travail</p>` line).

- [ ] **Step 2: Restructure into two grouped sections**

Replace the single `NAV_ITEMS` array:

```tsx
const NAV_ITEMS = [
  { label: 'Tableau de bord', href: 'dashboard', icon: LayoutDashboard },
  { label: 'Projets', href: 'projects', icon: FolderKanban },
  { label: 'Calendrier', href: 'calendar', icon: Calendar },
  { label: 'Mes tâches', href: 'tasks', icon: ListChecks },
  { label: 'Équipe', href: 'team', icon: Users },
  { label: 'Fichiers', href: 'files', icon: FileText },
];
```

with two arrays:

```tsx
const WORKSPACE_NAV_ITEMS = [
  { label: 'Tableau de bord', href: 'dashboard', icon: LayoutDashboard },
  { label: 'Projets', href: 'projects', icon: FolderKanban },
  { label: 'Calendrier', href: 'calendar', icon: Calendar },
  { label: 'Mes tâches', href: 'tasks', icon: ListChecks },
  { label: 'Équipe', href: 'team', icon: Users },
  { label: 'Fichiers', href: 'files', icon: FileText },
];

const COLLABORATION_NAV_ITEMS = [
  { label: 'Messagerie', href: 'messages', icon: MessageSquare },
  { label: 'Notes', href: 'notes', icon: StickyNote },
  { label: 'Mentions', href: 'mentions', icon: AtSign },
  { label: 'Activité récente', href: 'activity', icon: Activity },
];
```

Add `MessageSquare`, `StickyNote`, `AtSign`, and `Activity` to the existing
lucide-react import line (keep every icon already imported — this is an
addition, not a replacement of the import list).

Replace the `<nav>` block's contents:

```tsx
      <nav className="flex flex-1 flex-col gap-1 p-3">
        <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Espace de travail
        </p>
        {NAV_ITEMS.map((item) => {
          const hrefPath = item.href.split('?')[0];
          const isActive = pathname === `/w/${slug}/${hrefPath}`;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={`/w/${slug}/${item.href}`}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
```

with a version that renders both groups (extract the per-item rendering
into a small local helper so it's not duplicated twice):

```tsx
      <nav className="flex flex-1 flex-col gap-1 p-3">
        <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Espace de travail
        </p>
        {WORKSPACE_NAV_ITEMS.map((item) => renderNavItem(item, slug, pathname))}
        <p className="px-2 pt-4 pb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Collaboration
        </p>
        {COLLABORATION_NAV_ITEMS.map((item) => renderNavItem(item, slug, pathname))}
      </nav>
```

Add this helper function above the `Sidebar` component (module scope, same
level as `NAV_ITEMS`/`WORKSPACE_NAV_ITEMS` were):

```tsx
interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

function renderNavItem(item: NavItem, slug: string, pathname: string) {
  const hrefPath = item.href.split('?')[0];
  const isActive = pathname === `/w/${slug}/${hrefPath}`;
  const Icon = item.icon;
  return (
    <Link
      key={item.label}
      href={`/w/${slug}/${item.href}`}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
        isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50',
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}
```

- [ ] **Step 3: Run the full validation gate**

Run: `cd frontend && pnpm exec prettier --write "src/app/w/[orgSlug]/layout.tsx" && pnpm exec eslint "src/app/w/[orgSlug]/layout.tsx" && pnpm exec tsc --noEmit && pnpm test`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/layout.tsx"
git commit -m "feat(workspace): add sidebar section headers and collaboration nav items"
```
