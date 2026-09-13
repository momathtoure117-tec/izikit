# Workspace Foundation + Projects & Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot CoFound Africa from a co-founder-matching directory to a team project-management tool: remove the old FounderProfile/unlock domain, add Workspace (Organization) + Project + Task, and ship the navigation shell, onboarding, dashboard, and CRUD pages for the smallest usable end-to-end slice.

**Architecture:** Reuse the starter's existing `Organization`/`OrganizationMember`/`requireOrgRole` multi-tenancy primitives as "workspace" (the Prisma model names stay `Organization`/`OrganizationMember` per CLAUDE.md's "don't rename generic models" rule — only UI copy and route/page naming say "workspace"). Add two new Prisma models, `Project` and `Task`, both `organizationId`-scoped. New API routes live under `/api/organizations/*`, following the existing route conventions exactly (`runtime = 'nodejs'`, `makeRequestContext`/`withRequestContext`, `verifyCsrf` on mutations, `requireOrgRole` for authorization). New pages live under `/w/[orgSlug]/*`, sharing a client-side `WorkspaceProvider` that resolves the slug from the workspace list already fetched for the sidebar switcher (no new slug-lookup route needed).

**Tech Stack:** Next.js 16 App Router, Prisma 5 + Neon Postgres, Zod, Vitest + `vitest-mock-extended` (`prismaMock`), existing shared UI (`components/ui/*`: Button, Card, Badge, Input, Textarea, Label, Alert), lucide-react icons, Tailwind v4 indigo/slate design system.

**Spec:** [docs/superpowers/specs/2026-09-13-cofound-africa-workspace-foundation-design.md](../specs/2026-09-13-cofound-africa-workspace-foundation-design.md)

## Global Constraints

- Every Route Handler: `export const runtime = 'nodejs';` (enforced by `runtime-enforcement.test.ts`).
- Every mutating route calls `verifyCsrf(req)` before `requireAuth`/`requireOrgRole`.
- Wrap every handler body in `withRequestContext(makeRequestContext(req.headers), async () => {...})`.
- `requireOrgRole(organizationId, minRole)` returns `OrgContext | NextResponse`; check `instanceof NextResponse` and return it.
- Dynamic route params are `Promise`-typed in Next 16: `{ params: Promise<{ id: string }> }`, read via `await ctx.params`.
- Error responses: `NextResponse.json({ error: CODE, message }, { status, headers: { 'x-request-id': reqCtx.requestId } })`. Frontend branches on `ApiError.code`/`ApiError.status`, never on `.message`.
- Do NOT rename the `Organization`/`OrganizationMember` Prisma models. Do NOT modify `frontend/src/lib/server/middleware/index.ts`, `require-org-role.ts`, `auth.ts`, `admin/audit.ts`, or `lib/api.ts` (protected files).
- No admin-audit-log entries for workspace/project/task mutations (`logAdminAction` stays scoped to `/api/admin/*`).
- No emoji icons — use `lucide-react`. All new pages use the existing `components/ui/*` primitives and the indigo/slate palette already in `globals.css`.
- `pnpm format && pnpm lint && pnpm typecheck && pnpm test` must pass before every commit; run `pnpm build` at least once after Task 1 (the prune) and once at the end.

---

### Task 1: Prune the old FounderProfile/ProfileUnlock domain

**Files:**
- Modify: `frontend/src/app/api/webhooks/bictorys/route.ts` (surgical edit — remove unlock-granting block)
- Modify: `frontend/src/app/api/webhooks/bictorys/route.test.ts` (remove the 3 unlock-related tests)
- Modify: `frontend/prisma/schema.prisma` (remove `FounderProfile`, `ProfileUnlock` models; remove `User.founderProfile`, `User.profileUnlocks`, `Order.profileUnlock` relation fields)
- Delete: `frontend/src/lib/server/profiles/constants.ts`
- Delete: `frontend/src/app/api/profiles/route.ts`, `frontend/src/app/api/profiles/route.test.ts`
- Delete: `frontend/src/app/api/profiles/[id]/route.ts`, `frontend/src/app/api/profiles/[id]/route.test.ts`
- Delete: `frontend/src/app/api/profiles/me/route.ts`, `frontend/src/app/api/profiles/me/route.test.ts`
- Delete: `frontend/src/app/api/admin/profiles/route.ts`, `frontend/src/app/api/admin/profiles/route.test.ts`
- Delete: `frontend/src/app/api/admin/profiles/[id]/status/route.ts`
- Delete: `frontend/src/app/profile/page.tsx`
- Delete: `frontend/src/app/directory/page.tsx`, `frontend/src/app/directory/[id]/page.tsx`
- Delete: `frontend/src/app/orders/[id]/success/page.tsx`, `frontend/src/app/orders/[id]/failed/page.tsx`
- Delete: `frontend/src/app/admin/profiles/page.tsx`

**Interfaces:**
- Consumes: nothing (this task only removes code).
- Produces: a clean `Organization`-only multi-tenancy surface for Task 2 to build on. `Order`/`Withdrawal`/payments routes are untouched and stay generic.

- [ ] **Step 1: Surgical edit — remove the unlock-granting block from the webhook**

In `frontend/src/app/api/webhooks/bictorys/route.ts`, delete the import lines:

```ts
  PROFILE_UNLOCK_ORDER_TYPE,
  PROFILE_UNLOCK_PRICE_FCFA,
  PROFILE_UNLOCK_CURRENCY,
```

(these are 3 of the named imports from `@/lib/server/profiles/constants` — remove the whole `import { ... } from '@/lib/server/profiles/constants';` line since nothing else in the file uses that module), and delete this entire block from the `onPaid` handler (it sits right after the two `enqueueOutbox` calls and before `return {};`):

```ts
    // CoFound Africa Phase 1 — grant a ProfileUnlock only when the paid
    // amount matches the required price. This is the single enforcement
    // point that stops a tampered client from unlocking a contact by
    // submitting a cheaper amount to POST /api/orders.
    const unlockMeta = (order.metadata ?? null) as {
      type?: string;
      targetProfileId?: string;
    } | null;
    if (
      unlockMeta?.type === PROFILE_UNLOCK_ORDER_TYPE &&
      unlockMeta.targetProfileId &&
      order.userId &&
      order.amount === PROFILE_UNLOCK_PRICE_FCFA &&
      order.currency === PROFILE_UNLOCK_CURRENCY
    ) {
      await tx.profileUnlock.upsert({
        where: {
          unlockerUserId_targetProfileId: {
            unlockerUserId: order.userId,
            targetProfileId: unlockMeta.targetProfileId,
          },
        },
        create: {
          unlockerUserId: order.userId,
          targetProfileId: unlockMeta.targetProfileId,
          orderId: order.id,
        },
        update: {},
      });
    }
```

**Step 2: Surgical edit — remove the matching tests**

In `frontend/src/app/api/webhooks/bictorys/route.test.ts`:
- Remove the line `const profileUnlockUpsert = vi.fn();`
- Remove the `profileUnlock: { upsert: profileUnlockUpsert },` line from the mocked prisma client object
- Remove the line `profileUnlockUpsert.mockReset();` from the `beforeEach`
- Remove the three `it(...)` blocks whose titles are: `'onPaid creates a ProfileUnlock when the order metadata matches PROFILE_UNLOCK at the correct price'`, `'onPaid does NOT create a ProfileUnlock when the paid amount is below the required price'`, `'onPaid does NOT create a ProfileUnlock for regular (non-unlock) orders'` (delete each full `it(...) => { ... });` block).

- [ ] **Step 3: Run typecheck to confirm the webhook surgical edit is clean**

Run: `cd frontend && pnpm typecheck`
Expected: PASS (no leftover references to the deleted constants).

- [ ] **Step 4: Delete the old routes, pages, and constants file**

Delete every file listed under "Files" above except `schema.prisma` and the two webhook files already edited.

- [ ] **Step 5: Remove FounderProfile/ProfileUnlock from the Prisma schema**

In `frontend/prisma/schema.prisma`:
- Delete the `model FounderProfile { ... }` block and the `model ProfileUnlock { ... }` block entirely.
- In `model User`, delete these two lines:
  ```prisma
  founderProfile    FounderProfile?
  profileUnlocks    ProfileUnlock[]
  ```
- In `model Order`, delete this line:
  ```prisma
  profileUnlock   ProfileUnlock?
  ```

- [ ] **Step 6: Generate a migration**

Run: `cd frontend && pnpm db:migrate:dev --name prune_founder_profile_domain`
Expected: Prisma prints a migration dropping the `FounderProfile` and `ProfileUnlock` tables and regenerates the client. Confirm no errors.

- [ ] **Step 7: Run the full validation gate**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. If a test still references a deleted route/model, that test file was missed in Step 4 — find it with `grep -rl "FounderProfile\|ProfileUnlock\|founderProfile\|profileUnlock" frontend/src` and delete/fix it, then re-run.

- [ ] **Step 8: Run the build**

Run: `cd frontend && pnpm build`
Expected: build succeeds (catches stale imports the dev server's incremental compiler might not surface).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(prune): remove FounderProfile/ProfileUnlock co-founder-matching domain"
```

---

### Task 2: Add Project & Task Prisma models + last-owner guard helper

**Files:**
- Modify: `frontend/prisma/schema.prisma` (add `Project`, `Task` models; add back-relations on `User` and `Organization`)
- Create: `frontend/src/lib/server/organizations/guards.ts`
- Create: `frontend/src/lib/server/organizations/guards.test.ts`

**Interfaces:**
- Produces: `Project`/`Task` Prisma models and client types used by every route task below. `countOwners(tx, organizationId): Promise<number>` — used by Task 5's role-change/remove-member routes to enforce the last-OWNER guard.

- [ ] **Step 1: Add the Project and Task models**

In `frontend/prisma/schema.prisma`, add after the `OrganizationMember` model:

```prisma
model Project {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  description    String?
  status         String       @default("ACTIVE") // ACTIVE | COMPLETED | ARCHIVED
  createdById    String
  createdBy      User         @relation("ProjectCreator", fields: [createdById], references: [id], onDelete: Restrict)
  tasks          Task[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId])
  @@index([status])
}

model Task {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId      String
  project        Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  title          String
  status         String       @default("TODO") // TODO | IN_PROGRESS | DONE
  assigneeId     String?
  assignee       User?        @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  dueAt          DateTime?
  createdById    String
  createdBy      User         @relation("TaskCreator", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId, assigneeId])
  @@index([projectId])
  @@index([status])
}
```

Add to `model Organization`, right after the `members OrganizationMember[]` line:

```prisma
  projects  Project[]
  tasks     Task[]
```

Add to `model User`, right after `memberships OrganizationMember[] @relation("OrgMembership")`:

```prisma
  projectsCreated Project[] @relation("ProjectCreator")
  tasksCreated    Task[]    @relation("TaskCreator")
  tasksAssigned   Task[]    @relation("TaskAssignee")
```

- [ ] **Step 2: Generate the migration**

Run: `cd frontend && pnpm db:migrate:dev --name add_project_task`
Expected: migration creates the `Project` and `Task` tables; client regenerates with `prisma.project` / `prisma.task` available.

- [ ] **Step 3: Write the failing test for the last-owner guard**

Create `frontend/src/lib/server/organizations/guards.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect } from 'vitest';
import { countOwners } from './guards';

describe('countOwners', () => {
  it('counts OWNER members in the given organization', async () => {
    prismaMock.organizationMember.count.mockResolvedValueOnce(2);
    const count = await countOwners(prismaMock, 'org_1');
    expect(count).toBe(2);
    expect(prismaMock.organizationMember.count).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', role: 'OWNER' },
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && pnpm exec vitest run src/lib/server/organizations/guards.test.ts`
Expected: FAIL — `./guards` does not exist.

- [ ] **Step 5: Implement the guard helper**

Create `frontend/src/lib/server/organizations/guards.ts`:

```ts
import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Count OWNER-role members of an organization. Callers use this inside a
 * transaction (COUNT + mutation in the same tx) to prevent the race where
 * two concurrent demotions/removals both see count > 1 and both succeed,
 * leaving the organization with zero owners — mirrors the existing
 * last-SUPERADMIN guard in /api/admin/users/[id]/role.
 */
export async function countOwners(
  client: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
): Promise<number> {
  return client.organizationMember.count({
    where: { organizationId, role: 'OWNER' },
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && pnpm exec vitest run src/lib/server/organizations/guards.test.ts`
Expected: PASS.

- [ ] **Step 7: Run typecheck and full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations frontend/src/lib/server/organizations
git commit -m "feat(workspace): add Project and Task Prisma models + last-owner guard helper"
```

---

### Task 3: `POST` / `GET /api/organizations` — create and list workspaces

**Files:**
- Create: `frontend/src/app/api/organizations/route.ts`
- Create: `frontend/src/app/api/organizations/route.test.ts`

**Interfaces:**
- Consumes: `requireAuth()` from `@/lib/server/middleware`; `slugify`/`ensureUniqueSlug` from `@/lib/server/slug`.
- Produces: `POST` response `{ organization: { id, slug, name, role: 'OWNER' } }` (201). `GET` response `{ organizations: [{ id, slug, name, role }] }` (200) — consumed by the sidebar workspace switcher (Task 12) and the onboarding redirect check (Task 13/19).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { POST, GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const authCtx = { user: { sub: 'u1', email: 'u1@test.local' } };

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/organizations', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authCtx);
});

describe('POST /api/organizations', () => {
  it('creates an Organization + OWNER membership and returns 201', async () => {
    prismaMock.$transaction.mockImplementationOnce(async (fn: unknown) =>
      (fn as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock),
    );
    prismaMock.organization.create.mockResolvedValueOnce({
      id: 'org_1',
      slug: 'acme',
      name: 'Acme',
    } as never);
    prismaMock.organizationMember.create.mockResolvedValueOnce({} as never);

    const res = await POST(makePost({ name: 'Acme' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { organization: { id: string; role: string } };
    expect(body.organization.id).toBe('org_1');
    expect(body.organization.role).toBe('OWNER');
  });

  it('returns 400 VALIDATION_FAILED for an empty name', async () => {
    const res = await POST(makePost({ name: '' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/organizations', () => {
  it('lists the caller’s workspaces with role', async () => {
    prismaMock.organizationMember.findMany.mockResolvedValueOnce([
      { role: 'OWNER', organization: { id: 'org_1', slug: 'acme', name: 'Acme' } },
    ] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizations: { id: string; role: string }[] };
    expect(body.organizations).toEqual([
      { id: 'org_1', slug: 'acme', name: 'Acme', role: 'OWNER' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run src/app/api/organizations/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { slugify, ensureUniqueSlug } from '@/lib/server/slug';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const base = slugify(parsed.data.name) || 'workspace';
    const organization = await prisma.$transaction(async (tx) => {
      let created: { id: string; slug: string; name: string } | undefined;
      const slug = await ensureUniqueSlug(base, async (candidate) => {
        created = await tx.organization.create({
          data: { slug: candidate, name: parsed.data.name, ownerId: auth.user.sub },
          select: { id: true, slug: true, name: true },
        });
      });
      if (!created) throw new Error('organization creation failed');
      await tx.organizationMember.create({
        data: { organizationId: created.id, userId: auth.user.sub, role: 'OWNER' },
      });
      return { ...created, slug };
    });

    return NextResponse.json(
      { organization: { ...organization, role: 'OWNER' } },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: auth.user.sub },
      select: { role: true, organization: { select: { id: true, slug: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(
      {
        organizations: memberships.map((m) => ({
          id: m.organization.id,
          slug: m.organization.slug,
          name: m.organization.name,
          role: m.role,
        })),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run src/app/api/organizations/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/organizations/route.ts frontend/src/app/api/organizations/route.test.ts
git commit -m "feat(workspace): add POST/GET /api/organizations"
```

---

### Task 4: Workspace detail + members list/invite

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/route.test.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/members/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/members/route.test.ts`

**Interfaces:**
- Consumes: `requireOrgRole` from `@/lib/server/middleware`; `zEmail` from `@/lib/server/zod-helpers`.
- Produces: `GET /api/organizations/[orgId]` → `{ organization: { id, slug, name } }`. `GET .../members` → `{ members: [{ userId, email, name, role }] }`. `POST .../members` → `{ member: { userId, email, role } }` (201), consumed by Task 18 (team page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const orgCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(orgCtx);
});

describe('GET /api/organizations/[orgId]', () => {
  it('returns 200 { organization } for a member', async () => {
    prismaMock.organization.findUnique.mockResolvedValueOnce({
      id: 'org_1',
      slug: 'acme',
      name: 'Acme',
    } as never);
    const res = await GET(new NextRequest('http://test/api/organizations/org_1'), ctxWith('org_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organization: { id: string } };
    expect(body.organization.id).toBe('org_1');
  });

  it('propagates the 404 from requireOrgRole for a non-member', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Organization not found' }), {
        status: 404,
      }) as never,
    );
    const res = await GET(new NextRequest('http://test/api/organizations/org_1'), ctxWith('org_1'));
    expect(res.status).toBe(404);
  });
});
```

Create `frontend/src/app/api/organizations/[orgId]/members/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET, POST } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};
const adminCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'ADMIN' as const },
};

function ctxWith(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/members', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/organizations/[orgId]/members', () => {
  it('lists members', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(memberCtx);
    prismaMock.organizationMember.findMany.mockResolvedValueOnce([
      { role: 'OWNER', user: { id: 'u1', email: 'u1@test.local', name: null } },
    ] as never);
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/members'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { userId: string; role: string }[] };
    expect(body.members).toEqual([
      { userId: 'u1', email: 'u1@test.local', name: null, role: 'OWNER' },
    ]);
  });
});

describe('POST /api/organizations/[orgId]/members', () => {
  it('invites an existing user by email and returns 201', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u2', email: 'u2@test.local' } as never);
    prismaMock.organizationMember.create.mockResolvedValueOnce({ role: 'MEMBER' } as never);

    const res = await POST(makePost({ email: 'u2@test.local' }), ctxWith('org_1'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { member: { userId: string; role: string } };
    expect(body.member).toEqual({ userId: 'u2', email: 'u2@test.local', role: 'MEMBER' });
  });

  it('returns 404 USER_NOT_FOUND when the email matches no account', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never);

    const res = await POST(makePost({ email: 'nobody@test.local' }), ctxWith('org_1'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('USER_NOT_FOUND');
  });

  it('returns 409 ALREADY_MEMBER on a unique-constraint collision', async () => {
    mockRequireOrgRole.mockResolvedValueOnce(adminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u2', email: 'u2@test.local' } as never);
    prismaMock.organizationMember.create.mockRejectedValueOnce({ code: 'P2002' });

    const res = await POST(makePost({ email: 'u2@test.local' }), ctxWith('org_1'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ALREADY_MEMBER');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run src/app/api/organizations/[orgId]/route.test.ts src/app/api/organizations/[orgId]/members/route.test.ts`
Expected: FAIL — route files don't exist.

- [ ] **Step 3: Implement `GET /api/organizations/[orgId]`**

Create `frontend/src/app/api/organizations/[orgId]/route.ts`:

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

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true },
    });

    return NextResponse.json(
      { organization },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Implement `GET`/`POST /api/organizations/[orgId]/members`**

Create `frontend/src/app/api/organizations/[orgId]/members/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zEmail } from '@/lib/server/zod-helpers';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const InviteBody = z.object({ email: zEmail });

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const rows = await prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      select: { role: true, user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(
      {
        members: rows.map((r) => ({
          userId: r.user.id,
          email: r.user.email,
          name: r.user.name,
          role: r.role,
        })),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'ADMIN');
    if (auth instanceof NextResponse) return auth;

    const parsed = InviteBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const target = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'No account matches this email' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    try {
      const member = await prisma.organizationMember.create({
        data: { organizationId: orgId, userId: target.id, role: 'MEMBER' },
        select: { role: true },
      });
      return NextResponse.json(
        { member: { userId: target.id, email: target.email, role: member.role } },
        { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
      );
    } catch (err) {
      const isCollision =
        typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
      if (isCollision) {
        return NextResponse.json(
          { error: 'ALREADY_MEMBER', message: 'This user is already a member' },
          { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      throw err;
    }
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run src/app/api/organizations/[orgId]/route.test.ts src/app/api/organizations/[orgId]/members/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/route.ts" "frontend/src/app/api/organizations/[orgId]/route.test.ts" "frontend/src/app/api/organizations/[orgId]/members"
git commit -m "feat(workspace): add workspace detail and members list/invite routes"
```

---

### Task 5: Member role change + removal (last-owner guard)

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/members/[userId]/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/members/[userId]/route.test.ts`

**Interfaces:**
- Consumes: `countOwners` from `@/lib/server/organizations/guards` (Task 2).
- Produces: `PATCH` → `{ member: { userId, role } }` (200). `DELETE` → 204. Both used by Task 18 (team page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/members/[userId]/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const adminCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'ADMIN' as const },
};

function ctxWith(orgId: string, userId: string): { params: Promise<{ orgId: string; userId: string }> } {
  return { params: Promise.resolve({ orgId, userId }) };
}

function makePatch(body: unknown): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/members/u2', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function makeDelete(): NextRequest {
  return new NextRequest('http://test/api/organizations/org_1/members/u2', { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(adminCtx);
  prismaMock.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock),
  );
});

describe('PATCH /api/organizations/[orgId]/members/[userId]', () => {
  it('updates the role and returns 200', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);
    prismaMock.organizationMember.update.mockResolvedValueOnce({ role: 'ADMIN' } as never);

    const res = await PATCH(makePatch({ role: 'ADMIN' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { role: string } };
    expect(body.member.role).toBe('ADMIN');
  });

  it('refuses to demote the last OWNER with 409 LAST_OWNER', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(1);

    const res = await PATCH(makePatch({ role: 'MEMBER' }), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LAST_OWNER');
  });
});

describe('DELETE /api/organizations/[orgId]/members/[userId]', () => {
  it('removes the member and returns 204', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);
    prismaMock.organizationMember.delete.mockResolvedValueOnce({} as never);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(204);
  });

  it('refuses to remove the last OWNER with 409 LAST_OWNER', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({ role: 'OWNER' } as never);
    prismaMock.organizationMember.count.mockResolvedValueOnce(1);

    const res = await DELETE(makeDelete(), ctxWith('org_1', 'u2'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LAST_OWNER');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/members/[userId]/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/members/[userId]/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { countOwners } from '@/lib/server/organizations/guards';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const RoleBody = z.object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER']) });

type Discriminator =
  | { kind: 'NOT_FOUND' }
  | { kind: 'LAST_OWNER' }
  | { kind: 'OK'; role: string };

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; userId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, userId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'ADMIN');
    if (auth instanceof NextResponse) return auth;

    const parsed = RoleBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const result: Discriminator = await prisma.$transaction(async (tx) => {
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        select: { role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      if (target.role === 'OWNER' && parsed.data.role !== 'OWNER') {
        const owners = await countOwners(tx, orgId);
        if (owners <= 1) return { kind: 'LAST_OWNER' as const };
      }

      const updated = await tx.organizationMember.update({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        data: { role: parsed.data.role },
        select: { role: true },
      });
      return { kind: 'OK' as const, role: updated.role };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'Member not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (result.kind === 'LAST_OWNER') {
      return NextResponse.json(
        { error: 'LAST_OWNER', message: 'Refuse to demote the last owner' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    return NextResponse.json(
      { member: { userId, role: result.role } },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; userId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, userId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'ADMIN');
    if (auth instanceof NextResponse) return auth;

    const result: Discriminator = await prisma.$transaction(async (tx) => {
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId } },
        select: { role: true },
      });
      if (!target) return { kind: 'NOT_FOUND' as const };

      if (target.role === 'OWNER') {
        const owners = await countOwners(tx, orgId);
        if (owners <= 1) return { kind: 'LAST_OWNER' as const };
      }

      await tx.organizationMember.delete({
        where: { organizationId_userId: { organizationId: orgId, userId } },
      });
      return { kind: 'OK' as const, role: target.role };
    });

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'Member not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (result.kind === 'LAST_OWNER') {
      return NextResponse.json(
        { error: 'LAST_OWNER', message: 'Refuse to remove the last owner' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/members/[userId]/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/members/[userId]"
git commit -m "feat(workspace): add member role-change and removal routes with last-owner guard"
```

---

### Task 6: Projects — create and list (with task counts)

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/projects/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/projects/route.test.ts`

**Interfaces:**
- Produces: `POST` → `{ project: { id, name, description, status } }` (201). `GET` → `{ projects: [{ id, name, description, status, taskCounts: { total, done }, createdAt, updatedAt }] }` (200) — consumed by Task 15 (projects list page) and Task 10 (dashboard).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/projects/route.test.ts`:

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
  return new NextRequest('http://test/api/organizations/org_1/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('POST /api/organizations/[orgId]/projects', () => {
  it('creates a project and returns 201', async () => {
    prismaMock.project.create.mockResolvedValueOnce({
      id: 'p1',
      name: 'Website redesign',
      description: null,
      status: 'ACTIVE',
    } as never);

    const res = await POST(makePost({ name: 'Website redesign' }), ctxWith('org_1'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string } };
    expect(body.project.id).toBe('p1');
  });

  it('returns 400 VALIDATION_FAILED for an empty name', async () => {
    const res = await POST(makePost({ name: '' }), ctxWith('org_1'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/organizations/[orgId]/projects', () => {
  it('lists projects with computed task counts', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'Website redesign',
        description: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        tasks: [{ status: 'DONE' }, { status: 'TODO' }, { status: 'DONE' }],
      },
    ] as never);

    const res = await GET(new NextRequest('http://test/api/organizations/org_1/projects'), ctxWith('org_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: { id: string; taskCounts: { total: number; done: number } }[];
    };
    expect(body.projects[0]?.taskCounts).toEqual({ total: 3, done: 2 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/route.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/projects/route.ts`:

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
  name: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional(),
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

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        createdById: auth.user.sub,
      },
      select: { id: true, name: true, description: true, status: true },
    });

    return NextResponse.json(
      { project },
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

    const rows = await prisma.project.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        tasks: { select: { status: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const projects = rows.map(({ tasks, ...project }) => ({
      ...project,
      taskCounts: {
        total: tasks.length,
        done: tasks.filter((t) => t.status === 'DONE').length,
      },
    }));

    return NextResponse.json(
      { projects },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/projects/route.ts" "frontend/src/app/api/organizations/[orgId]/projects/route.test.ts"
git commit -m "feat(workspace): add project create/list routes with task-count aggregation"
```

---

### Task 7: Project detail, update, delete

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/route.test.ts`

**Interfaces:**
- Produces: `GET` → `{ project: { id, name, description, status, tasks: [{ id, title, status, assigneeId, dueAt }] } }`. `PATCH` → `{ project }`. `DELETE` → 204. Consumed by Task 16 (project detail page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { GET, PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string, projectId: string): {
  params: Promise<{ orgId: string; projectId: string }>;
} {
  return { params: Promise.resolve({ orgId, projectId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('GET /api/organizations/[orgId]/projects/[projectId]', () => {
  it('returns the project with its tasks', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'p1',
      name: 'Website redesign',
      description: null,
      status: 'ACTIVE',
      tasks: [{ id: 't1', title: 'Design mock', status: 'TODO', assigneeId: null, dueAt: null }],
    } as never);
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/projects/p1'),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { id: string } };
    expect(body.project.id).toBe('p1');
  });

  it('returns 404 PROJECT_NOT_FOUND when the project is not in this org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null as never);
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/projects/missing'),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/organizations/[orgId]/projects/[projectId]', () => {
  it('updates the project and returns 200', async () => {
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'p1',
      name: 'New name',
      description: null,
      status: 'ACTIVE',
    } as never);
    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/projects/p1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New name' }),
      }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/organizations/[orgId]/projects/[projectId]', () => {
  it('deletes the project and returns 204', async () => {
    prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 1 } as never);
    const res = await DELETE(
      new NextRequest('http://test/api/organizations/org_1/projects/p1', { method: 'DELETE' }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(204);
  });

  it('returns 404 PROJECT_NOT_FOUND when nothing was deleted', async () => {
    prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 0 } as never);
    const res = await DELETE(
      new NextRequest('http://test/api/organizations/org_1/projects/missing', { method: 'DELETE' }),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/route.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED']).optional(),
});

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; projectId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId, projectId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        tasks: {
          select: { id: true, title: true, status: true, assigneeId: true, dueAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return NextResponse.json(
      { project },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function PATCH(
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

    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { count } = await prisma.project.updateMany({
      where: { id: projectId, organizationId: orgId },
      data: parsed.data,
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true, name: true, description: true, status: true },
    });

    return NextResponse.json(
      { project },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
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

    const { count } = await prisma.project.deleteMany({
      where: { id: projectId, organizationId: orgId },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
```

Note: `updateMany`/`deleteMany` scoped by `{ id: projectId, organizationId: orgId }` (rather than `findUnique` + separate org check) atomically enforces tenant isolation — a project ID from another org can never be mutated, in one round trip.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/projects/[projectId]"
git commit -m "feat(workspace): add project detail/update/delete routes"
```

---

### Task 8: Tasks — create under a project, and cross-project "my tasks"

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/tasks/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/tasks/route.test.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/tasks/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/tasks/route.test.ts`

**Interfaces:**
- Produces: `POST .../projects/[projectId]/tasks` → `{ task: { id, title, status, assigneeId, dueAt } }` (201). `GET /api/organizations/[orgId]/tasks?assignee=me` → `{ tasks: [{ id, title, status, dueAt, project: { id, name } }] }` (200) — consumed by Task 17 ("Mes tâches" page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/tasks/route.test.ts`:

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

function ctxWith(orgId: string, projectId: string): {
  params: Promise<{ orgId: string; projectId: string }>;
} {
  return { params: Promise.resolve({ orgId, projectId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('POST /api/organizations/[orgId]/projects/[projectId]/tasks', () => {
  it('creates a task scoped to the project’s org and returns 201', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'p1' } as never);
    prismaMock.task.create.mockResolvedValueOnce({
      id: 't1',
      title: 'Design mock',
      status: 'TODO',
      assigneeId: null,
      dueAt: null,
    } as never);

    const res = await POST(
      new NextRequest('http://test/api/organizations/org_1/projects/p1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Design mock' }),
      }),
      ctxWith('org_1', 'p1'),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { task: { id: string } };
    expect(body.task.id).toBe('t1');
  });

  it('returns 404 PROJECT_NOT_FOUND when the project is not in this org', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null as never);
    const res = await POST(
      new NextRequest('http://test/api/organizations/org_1/projects/missing/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'x' }),
      }),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});
```

Create `frontend/src/app/api/organizations/[orgId]/tasks/route.test.ts`:

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

describe('GET /api/organizations/[orgId]/tasks', () => {
  it('returns 400 VALIDATION_FAILED when ?assignee is missing or not "me"', async () => {
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/tasks'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(400);
  });

  it('lists the caller’s tasks across all projects when ?assignee=me', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        title: 'Design mock',
        status: 'TODO',
        dueAt: null,
        project: { id: 'p1', name: 'Website redesign' },
      },
    ] as never);

    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/tasks?assignee=me'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1', assigneeId: 'u1' } }),
    );
    const body = (await res.json()) as { tasks: { id: string }[] };
    expect(body.tasks[0]?.id).toBe('t1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/tasks/route.test.ts" "src/app/api/organizations/[orgId]/tasks/route.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement `POST .../projects/[projectId]/tasks`**

Create `frontend/src/app/api/organizations/[orgId]/projects/[projectId]/tasks/route.ts`:

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
  title: z.string().trim().min(1).max(200),
  assigneeId: zCuid.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
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

    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        projectId,
        title: parsed.data.title,
        assigneeId: parsed.data.assigneeId ?? null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        createdById: auth.user.sub,
      },
      select: { id: true, title: true, status: true, assigneeId: true, dueAt: true },
    });

    return NextResponse.json(
      { task },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Implement `GET /api/organizations/[orgId]/tasks?assignee=me`**

Create `frontend/src/app/api/organizations/[orgId]/tasks/route.ts`:

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

    // "me" is the only supported value in v1 — no arbitrary-user lookup.
    const assignee = req.nextUrl.searchParams.get('assignee');
    if (assignee !== 'me') {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'assignee must be "me"' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const tasks = await prisma.task.findMany({
      where: { organizationId: orgId, assigneeId: auth.user.sub },
      select: {
        id: true,
        title: true,
        status: true,
        dueAt: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json(
      { tasks },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/projects/[projectId]/tasks/route.test.ts" "src/app/api/organizations/[orgId]/tasks/route.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/projects/[projectId]/tasks" "frontend/src/app/api/organizations/[orgId]/tasks/route.ts" "frontend/src/app/api/organizations/[orgId]/tasks/route.test.ts"
git commit -m "feat(workspace): add task creation and cross-project my-tasks routes"
```

---

### Task 9: Task update and delete

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/tasks/[taskId]/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/tasks/[taskId]/route.test.ts`

**Interfaces:**
- Produces: `PATCH` → `{ task }` (200). `DELETE` → 204. Consumed by Task 16 (project detail) and Task 17 ("Mes tâches").

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/organizations/[orgId]/tasks/[taskId]/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/server/middleware';
import { PATCH, DELETE } from './route';

const mockRequireOrgRole = vi.mocked(requireOrgRole);
const memberCtx = {
  user: { sub: 'u1', email: 'u1@test.local' },
  orgMember: { organizationId: 'org_1', userId: 'u1', role: 'MEMBER' as const },
};

function ctxWith(orgId: string, taskId: string): { params: Promise<{ orgId: string; taskId: string }> } {
  return { params: Promise.resolve({ orgId, taskId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(memberCtx);
});

describe('PATCH /api/organizations/[orgId]/tasks/[taskId]', () => {
  it('updates the task status and returns 200', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.task.findFirst.mockResolvedValueOnce({
      id: 't1',
      title: 'Design mock',
      status: 'DONE',
      assigneeId: null,
      dueAt: null,
    } as never);

    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DONE' }),
      }),
      ctxWith('org_1', 't1'),
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 TASK_NOT_FOUND when nothing was updated', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 } as never);
    const res = await PATCH(
      new NextRequest('http://test/api/organizations/org_1/tasks/missing', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DONE' }),
      }),
      ctxWith('org_1', 'missing'),
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/organizations/[orgId]/tasks/[taskId]', () => {
  it('deletes the task and returns 204', async () => {
    prismaMock.task.deleteMany.mockResolvedValueOnce({ count: 1 } as never);
    const res = await DELETE(
      new NextRequest('http://test/api/organizations/org_1/tasks/t1', { method: 'DELETE' }),
      ctxWith('org_1', 't1'),
    );
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/tasks/[taskId]/route.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/tasks/[taskId]/route.ts`:

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

const UpdateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  assigneeId: zCuid.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; taskId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, taskId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { title, status, assigneeId, dueAt } = parsed.data;
    const { count } = await prisma.task.updateMany({
      where: { id: taskId, organizationId: orgId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
      },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'TASK_NOT_FOUND', message: 'Task not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
      select: { id: true, title: true, status: true, assigneeId: true, dueAt: true },
    });

    return NextResponse.json(
      { task },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; taskId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, taskId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const { count } = await prisma.task.deleteMany({
      where: { id: taskId, organizationId: orgId },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'TASK_NOT_FOUND', message: 'Task not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/tasks/[taskId]/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/tasks/[taskId]"
git commit -m "feat(workspace): add task update/delete routes"
```

---

### Task 10: Dashboard aggregation route

**Files:**
- Create: `frontend/src/app/api/organizations/[orgId]/dashboard/route.ts`
- Create: `frontend/src/app/api/organizations/[orgId]/dashboard/route.test.ts`

**Interfaces:**
- Produces: `GET` → `{ activeProjectsCount, tasksInProgressCount, tasksDoneCount, memberCount, upcomingDeadlines: [{ id, title, dueAt, project: { id, name } }], recentActivity: [{ type: 'project'|'task', id, title, updatedAt }], projectsProgress: [{ id, name, total, done }] }`. Consumed by Task 14 (dashboard page).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/api/organizations/[orgId]/dashboard/route.test.ts`:

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
  prismaMock.project.count.mockResolvedValue(2);
  prismaMock.task.count.mockResolvedValue(3);
  prismaMock.organizationMember.count.mockResolvedValue(4);
  prismaMock.task.findMany.mockResolvedValue([] as never);
  prismaMock.project.findMany.mockResolvedValue([] as never);
});

describe('GET /api/organizations/[orgId]/dashboard', () => {
  it('returns the aggregated dashboard summary with 200', async () => {
    const res = await GET(
      new NextRequest('http://test/api/organizations/org_1/dashboard'),
      ctxWith('org_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activeProjectsCount: number;
      memberCount: number;
      upcomingDeadlines: unknown[];
      recentActivity: unknown[];
      projectsProgress: unknown[];
    };
    expect(body.activeProjectsCount).toBe(2);
    expect(body.memberCount).toBe(4);
    expect(body.upcomingDeadlines).toEqual([]);
    expect(body.recentActivity).toEqual([]);
    expect(body.projectsProgress).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/dashboard/route.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/organizations/[orgId]/dashboard/route.ts`:

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

type ActivityRow = { type: 'project' | 'task'; id: string; title: string; updatedAt: Date };

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      activeProjectsCount,
      tasksInProgressCount,
      tasksDoneCount,
      memberCount,
      upcomingDeadlines,
      recentProjects,
      recentTasks,
      activeProjects,
    ] = await Promise.all([
      prisma.project.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
      prisma.task.count({ where: { organizationId: orgId, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { organizationId: orgId, status: 'DONE' } }),
      prisma.organizationMember.count({ where: { organizationId: orgId } }),
      prisma.task.findMany({
        where: {
          organizationId: orgId,
          status: { not: 'DONE' },
          dueAt: { gte: now, lte: in7Days },
        },
        select: { id: true, title: true, dueAt: true, project: { select: { id: true, name: true } } },
        orderBy: { dueAt: 'asc' },
        take: 10,
      }),
      prisma.project.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.task.findMany({
        where: { organizationId: orgId },
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.project.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { id: true, name: true, tasks: { select: { status: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);

    const recentActivity: ActivityRow[] = [
      ...recentProjects.map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: p.name,
        updatedAt: p.updatedAt,
      })),
      ...recentTasks.map((t) => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt,
      })),
    ]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 10);

    const projectsProgress = activeProjects.map(({ tasks, ...p }) => ({
      id: p.id,
      name: p.name,
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'DONE').length,
    }));

    return NextResponse.json(
      {
        activeProjectsCount,
        tasksInProgressCount,
        tasksDoneCount,
        memberCount,
        upcomingDeadlines,
        recentActivity,
        projectsProgress,
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && pnpm exec vitest run "src/app/api/organizations/[orgId]/dashboard/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the full backend test suite + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. This closes out all backend routes for this sub-project.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/api/organizations/[orgId]/dashboard"
git commit -m "feat(workspace): add dashboard aggregation route"
```

---

### Task 11: Shared `Progress` UI component

**Files:**
- Create: `frontend/src/components/ui/progress.tsx`

**Interfaces:**
- Produces: `Progress` component, `props: { value: number; max?: number; className?: string }` (renders a filled bar `value/max` wide). Consumed by Task 14 (dashboard) and Task 15 (projects list).

- [ ] **Step 1: Implement the component**

Create `frontend/src/components/ui/progress.tsx`:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, max = 100, className, ...props }, ref) => {
    const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}
        {...props}
      >
        <div
          className="h-full rounded-full bg-indigo-600 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/progress.tsx
git commit -m "feat(ui): add Progress bar component"
```

---

### Task 12: Workspace context + `/w/[orgSlug]` navigation shell

**Files:**
- Create: `frontend/src/contexts/WorkspaceContext.tsx`
- Create: `frontend/src/app/w/[orgSlug]/layout.tsx`

**Interfaces:**
- Produces: `WorkspaceProvider` (fetches `GET /api/organizations`, resolves the current org by matching `orgSlug` from the URL) and `useWorkspace(): { organizationId: string; slug: string; name: string; role: 'OWNER'|'ADMIN'|'MEMBER'; organizations: {id,slug,name,role}[]; loading: boolean; notFound: boolean }`. Consumed by every page under `/w/[orgSlug]/*` (Tasks 14-18) to get the current `organizationId` for API calls, and to render the sidebar + workspace switcher.

- [ ] **Step 1: Implement `WorkspaceContext`**

Create `frontend/src/contexts/WorkspaceContext.tsx`:

```tsx
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

interface WorkspaceContextValue {
  organizationId: string | null;
  slug: string;
  name: string;
  role: WorkspaceSummary['role'] | null;
  organizations: WorkspaceSummary[];
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const params = useParams<{ orgSlug: string }>();
  const slug = params.orgSlug;
  const [organizations, setOrganizations] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<{ organizations: WorkspaceSummary[] }>('/api/organizations')
      .then((res) => {
        if (!cancelled) setOrganizations(res.organizations);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = organizations.find((o) => o.slug === slug) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        organizationId: current?.id ?? null,
        slug,
        name: current?.name ?? '',
        role: current?.role ?? null,
        organizations,
        loading,
        notFound: !loading && !error && current === null,
        error,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside a WorkspaceProvider');
  return ctx;
}
```

- [ ] **Step 2: Implement the layout (sidebar + workspace switcher)**

Create `frontend/src/app/w/[orgSlug]/layout.tsx`:

```tsx
'use client';

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderKanban, ListChecks, Users, ChevronDown, Plus } from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';

// Note: the spec's original mockup listed "Tâches" and "Mes tâches" as two
// separate items, but the only tasks route this sub-project builds is the
// cross-project "assigned to me" list (see Task 8) — there is no general
// "all tasks in the workspace" endpoint. Rather than ship two nav items
// pointing at the same page, this collapses them into one ("Mes tâches").
// A future sub-project can reintroduce a separate all-tasks view backed by
// its own route once that's actually needed.
const NAV_ITEMS = [
  { label: 'Tableau de bord', href: 'dashboard', icon: LayoutDashboard },
  { label: 'Projets', href: 'projects', icon: FolderKanban },
  { label: 'Mes tâches', href: 'tasks', icon: ListChecks },
  { label: 'Équipe', href: 'team', icon: Users },
];

function Sidebar() {
  const { slug, name, organizations, loading, notFound } = useWorkspace();
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="relative border-b border-slate-200 p-4">
        <button
          type="button"
          onClick={() => setSwitcherOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          <span className="truncate">{loading ? 'Chargement…' : (name || 'Espace de travail')}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
        {switcherOpen && (
          <div className="absolute left-4 right-4 z-10 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-md">
            {organizations.map((org) => (
              <Link
                key={org.id}
                href={`/w/${org.slug}/dashboard`}
                className={cn(
                  'block px-3 py-2 text-sm hover:bg-slate-50',
                  org.slug === slug ? 'font-medium text-indigo-600' : 'text-slate-700',
                )}
                onClick={() => setSwitcherOpen(false)}
              >
                {org.name}
              </Link>
            ))}
            <Link
              href="/onboarding"
              className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setSwitcherOpen(false)}
            >
              <Plus className="h-3.5 w-3.5" />
              Créer un espace de travail
            </Link>
          </div>
        )}
      </div>

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

      {notFound && (
        <p className="border-t border-slate-200 p-3 text-xs text-red-600">
          Espace de travail introuvable.
        </p>
      )}
    </aside>
  );
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/contexts/WorkspaceContext.tsx "frontend/src/app/w/[orgSlug]/layout.tsx"
git commit -m "feat(workspace): add WorkspaceContext and the /w/[orgSlug] navigation shell"
```

---

### Task 13: Onboarding page (create first workspace)

**Files:**
- Create: `frontend/src/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `POST /api/organizations` (Task 3), `GET /api/organizations` (Task 3).
- Produces: on mount, if the user already has a workspace, redirects straight to `/w/[firstOrgSlug]/dashboard`; otherwise shows a "create your workspace" form that `POST`s and redirects to the new workspace's dashboard.

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/onboarding/page.tsx`:

```tsx
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Building2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Organization {
  id: string;
  slug: string;
  name: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ organizations: Organization[] }>('/api/organizations')
      .then((res) => {
        if (cancelled) return;
        const first = res.organizations[0];
        if (first) {
          router.replace(`/w/${first.slug}/dashboard`);
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ organization: Organization }>('/api/organizations', {
        method: 'POST',
        body: { name },
      });
      router.push(`/w/${res.organization.slug}/dashboard`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-600">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Building2 className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">Crée ton espace de travail</CardTitle>
          <CardDescription>
            Un espace de travail regroupe tes projets, tes tâches et ton équipe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Nom de l&rsquo;espace de travail</Label>
              <Input
                id="name"
                required
                autoFocus
                placeholder="Mon entreprise"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Création…' : 'Créer l’espace de travail'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/onboarding
git commit -m "feat(workspace): add onboarding page to create the first workspace"
```

---

### Task 14: Dashboard page

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/dashboard/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()` (Task 12), `GET /api/organizations/[orgId]/dashboard` (Task 10), `Progress` (Task 11).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/dashboard/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Sparkles, FolderKanban, ListChecks, CheckCircle2, Users, Plus } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi } from '@/lib/useApi';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface DashboardSummary {
  activeProjectsCount: number;
  tasksInProgressCount: number;
  tasksDoneCount: number;
  memberCount: number;
  upcomingDeadlines: { id: string; title: string; dueAt: string; project: { id: string; name: string } }[];
  recentActivity: { type: 'project' | 'task'; id: string; title: string; updatedAt: string }[];
  projectsProgress: { id: string; name: string; total: number; done: number }[];
}

export default function DashboardPage() {
  const { organizationId, slug, loading: wsLoading } = useWorkspace();
  const { data, loading } = useApi<DashboardSummary>(
    organizationId ? `/api/organizations/${organizationId}/dashboard` : '',
    { skip: !organizationId },
  );

  if (wsLoading || loading || !data) {
    return <div className="p-8 text-sm text-slate-600">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            Bonjour
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Voici ce qui se passe dans votre espace de travail aujourd&rsquo;hui.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/w/${slug}/projects`} className={buttonVariants({ variant: 'outline' })}>
            <Plus className="h-4 w-4" />
            Nouveau projet
          </Link>
          <Link href={`/w/${slug}/projects`} className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            Nouvelle tâche
          </Link>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <FolderKanban className="h-4 w-4 text-indigo-600" />
            <span className="text-2xl font-semibold text-slate-900">{data.activeProjectsCount}</span>
            <span className="text-xs text-slate-500">Projets actifs</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <ListChecks className="h-4 w-4 text-indigo-600" />
            <span className="text-2xl font-semibold text-slate-900">{data.tasksInProgressCount}</span>
            <span className="text-xs text-slate-500">Tâches en cours</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-2xl font-semibold text-slate-900">{data.tasksDoneCount}</span>
            <span className="text-xs text-slate-500">Tâches terminées</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <Users className="h-4 w-4 text-indigo-600" />
            <span className="text-2xl font-semibold text-slate-900">{data.memberCount}</span>
            <span className="text-xs text-slate-500">Membres de l&rsquo;équipe</span>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progression des projets</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.projectsProgress.length === 0 && (
              <p className="text-sm text-slate-500">Aucun projet actif.</p>
            )}
            {data.projectsProgress.map((p) => (
              <div key={p.id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className="text-slate-500">
                    {p.done}/{p.total}
                  </span>
                </div>
                <Progress value={p.done} max={p.total || 1} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Échéances à venir</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.upcomingDeadlines.length === 0 && (
              <p className="text-sm text-slate-500">Aucune échéance dans les 7 prochains jours.</p>
            )}
            {data.upcomingDeadlines.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-500">{t.project.name}</p>
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(t.dueAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Activité récente</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.recentActivity.length === 0 && (
              <p className="text-sm text-slate-500">Aucune activité récente.</p>
            )}
            {data.recentActivity.map((a) => (
              <div key={`${a.type}-${a.id}`} className="flex items-center justify-between text-sm">
                <span className="text-slate-900">
                  {a.type === 'project' ? 'Projet' : 'Tâche'} — {a.title}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(a.updatedAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual smoke check**

With `pnpm dev` running and a logged-in session that owns a workspace, visit `/w/<slug>/dashboard` and confirm the summary cards, progress bars, and lists render without console errors.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/dashboard"
git commit -m "feat(workspace): add dashboard page"
```

---

### Task 15: Projects list page (with create form)

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/projects/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `GET`/`POST /api/organizations/[orgId]/projects` (Task 6), `Progress` (Task 11).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/projects/page.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plus, FolderKanban } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  taskCounts: { total: number; done: number };
}

const STATUS_LABEL: Record<Project['status'], string> = {
  ACTIVE: 'Actif',
  COMPLETED: 'Terminé',
  ARCHIVED: 'Archivé',
};

const STATUS_BADGE_VARIANT: Record<Project['status'], 'success' | 'secondary' | 'outline'> = {
  ACTIVE: 'success',
  COMPLETED: 'secondary',
  ARCHIVED: 'outline',
};

export default function ProjectsPage() {
  const { organizationId, slug, loading: wsLoading } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/projects` : '';
  const { data, loading } = useApi<{ projects: Project[] }>(path, { skip: !organizationId });

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setCreating(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: { name } });
      setName('');
      invalidateCache(path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setCreating(false);
    }
  }

  if (wsLoading || loading) {
    return <div className="p-8 text-sm text-slate-600">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Projets</h1>
      </header>

      <Card className="mt-4">
        <CardContent className="p-4">
          <form onSubmit={onCreate} className="flex gap-2">
            <Input
              placeholder="Nom du nouveau projet"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Button type="submit" disabled={creating}>
              <Plus className="h-4 w-4" />
              {creating ? 'Création…' : 'Nouveau projet'}
            </Button>
          </form>
          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-3">
        {(data?.projects.length ?? 0) === 0 && (
          <p className="text-sm text-slate-500">Aucun projet pour l&rsquo;instant.</p>
        )}
        {data?.projects.map((project) => (
          <Link key={project.id} href={`/w/${slug}/projects/${project.id}`}>
            <Card className="transition-colors hover:border-indigo-300">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <FolderKanban className="h-5 w-5 text-indigo-600" />
                  <div>
                    <p className="font-medium text-slate-900">{project.name}</p>
                    {project.description && (
                      <p className="text-sm text-slate-500">{project.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-32">
                    <Progress value={project.taskCounts.done} max={project.taskCounts.total || 1} />
                  </div>
                  <Badge variant={STATUS_BADGE_VARIANT[project.status]}>
                    {STATUS_LABEL[project.status]}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm `invalidateCache` is exported from `@/lib/useApi`**

Run: `grep -n "export function invalidateCache" frontend/src/lib/useApi.ts`
Expected: a match. If none, the exported name differs — check `frontend/src/app/directory/page.tsx`'s import line for the name this codebase actually uses (`invalidateCache` or `invalidateCachePrefix`) and use that same name here instead.

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/projects/page.tsx"
git commit -m "feat(workspace): add projects list page with inline create form"
```

---

### Task 16: Project detail page (tasks list + create task form)

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `GET /api/organizations/[orgId]/projects/[projectId]` (Task 7), `POST .../tasks` (Task 8), `PATCH /api/organizations/[orgId]/tasks/[taskId]` (Task 9).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/projects/[projectId]/page.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Task {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assigneeId: string | null;
  dueAt: string | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  tasks: Task[];
}

const STATUS_LABEL: Record<Task['status'], string> = {
  TODO: 'À faire',
  IN_PROGRESS: 'En cours',
  DONE: 'Terminé',
};

const STATUS_BADGE_VARIANT: Record<Task['status'], 'secondary' | 'default' | 'success'> = {
  TODO: 'secondary',
  IN_PROGRESS: 'default',
  DONE: 'success',
};

const NEXT_STATUS: Record<Task['status'], Task['status']> = {
  TODO: 'IN_PROGRESS',
  IN_PROGRESS: 'DONE',
  DONE: 'TODO',
};

export default function ProjectDetailPage() {
  const { organizationId, slug, loading: wsLoading } = useWorkspace();
  const params = useParams<{ projectId: string }>();
  const path = organizationId
    ? `/api/organizations/${organizationId}/projects/${params.projectId}`
    : '';
  const { data, loading } = useApi<{ project: ProjectDetail }>(path, { skip: !organizationId });

  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setCreating(true);
    setError(null);
    try {
      await api(`${path}/tasks`, { method: 'POST', body: { title } });
      setTitle('');
      invalidateCache(path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setCreating(false);
    }
  }

  async function onCycleStatus(task: Task) {
    if (!organizationId) return;
    await api(`/api/organizations/${organizationId}/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status: NEXT_STATUS[task.status] },
    });
    invalidateCache(path);
  }

  if (wsLoading || loading || !data) {
    return <div className="p-8 text-sm text-slate-600">Chargement…</div>;
  }

  const { project } = data;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href={`/w/${slug}/projects`}
        className="flex items-center gap-1.5 text-sm text-slate-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Projets
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{project.name}</h1>
      {project.description && <p className="mt-1 text-sm text-slate-600">{project.description}</p>}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Nouvelle tâche</CardTitle>
          <CardDescription>Ajoute une tâche à ce projet.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreateTask} className="flex gap-2">
            <Input
              placeholder="Titre de la tâche"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <Button type="submit" disabled={creating}>
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          </form>
          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-2">
        {project.tasks.length === 0 && (
          <p className="text-sm text-slate-500">Aucune tâche pour l&rsquo;instant.</p>
        )}
        {project.tasks.map((task) => (
          <Card key={task.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <span className="text-sm font-medium text-slate-900">{task.title}</span>
              <button type="button" onClick={() => onCycleStatus(task)} className="cursor-pointer">
                <Badge variant={STATUS_BADGE_VARIANT[task.status]}>
                  {STATUS_LABEL[task.status]}
                </Badge>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/projects/[projectId]"
git commit -m "feat(workspace): add project detail page with task list and status cycling"
```

---

### Task 17: "Mes tâches" page

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/tasks/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `GET /api/organizations/[orgId]/tasks?assignee=me` (Task 8), `PATCH /api/organizations/[orgId]/tasks/[taskId]` (Task 9).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/tasks/page.tsx`:

```tsx
'use client';

import { ListChecks } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface MyTask {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  dueAt: string | null;
  project: { id: string; name: string };
}

const STATUS_LABEL: Record<MyTask['status'], string> = {
  TODO: 'À faire',
  IN_PROGRESS: 'En cours',
  DONE: 'Terminé',
};

const STATUS_BADGE_VARIANT: Record<MyTask['status'], 'secondary' | 'default' | 'success'> = {
  TODO: 'secondary',
  IN_PROGRESS: 'default',
  DONE: 'success',
};

const NEXT_STATUS: Record<MyTask['status'], MyTask['status']> = {
  TODO: 'IN_PROGRESS',
  IN_PROGRESS: 'DONE',
  DONE: 'TODO',
};

export default function MyTasksPage() {
  const { organizationId, loading: wsLoading } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/tasks?assignee=me` : '';
  const { data, loading } = useApi<{ tasks: MyTask[] }>(path, { skip: !organizationId });

  async function onCycleStatus(task: MyTask) {
    if (!organizationId) return;
    await api(`/api/organizations/${organizationId}/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status: NEXT_STATUS[task.status] },
    });
    invalidateCache(path);
  }

  if (wsLoading || loading) {
    return <div className="p-8 text-sm text-slate-600">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
        <ListChecks className="h-5 w-5 text-indigo-600" />
        Mes tâches
      </h1>

      <div className="mt-4 flex flex-col gap-2">
        {(data?.tasks.length ?? 0) === 0 && (
          <p className="text-sm text-slate-500">Aucune tâche ne t&rsquo;est assignée.</p>
        )}
        {data?.tasks.map((task) => (
          <Card key={task.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">{task.title}</p>
                <p className="text-xs text-slate-500">
                  {task.project.name}
                  {task.dueAt && ` · ${new Date(task.dueAt).toLocaleDateString('fr-FR')}`}
                </p>
              </div>
              <button type="button" onClick={() => onCycleStatus(task)} className="cursor-pointer">
                <Badge variant={STATUS_BADGE_VARIANT[task.status]}>
                  {STATUS_LABEL[task.status]}
                </Badge>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/tasks/page.tsx"
git commit -m "feat(workspace): add my-tasks page"
```

---

### Task 18: Team page (members list, invite, role change, remove)

**Files:**
- Create: `frontend/src/app/w/[orgSlug]/team/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, `GET`/`POST /api/organizations/[orgId]/members` (Task 4), `PATCH`/`DELETE /api/organizations/[orgId]/members/[userId]` (Task 5).

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/w/[orgSlug]/team/page.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Users, UserPlus, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export default function TeamPage() {
  const { organizationId, role, loading: wsLoading } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/members` : '';
  const { data, loading } = useApi<{ members: Member[] }>(path, { skip: !organizationId });

  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = role === 'OWNER' || role === 'ADMIN';

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setInviting(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: { email } });
      setEmail('');
      invalidateCache(path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setInviting(false);
    }
  }

  async function onRoleChange(userId: string, newRole: Member['role']) {
    if (!organizationId) return;
    setError(null);
    try {
      await api(`${path}/${userId}`, { method: 'PATCH', body: { role: newRole } });
      invalidateCache(path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    }
  }

  async function onRemove(userId: string) {
    if (!organizationId) return;
    setError(null);
    try {
      await api(`${path}/${userId}`, { method: 'DELETE' });
      invalidateCache(path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    }
  }

  if (wsLoading || loading) {
    return <div className="p-8 text-sm text-slate-600">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
        <Users className="h-5 w-5 text-indigo-600" />
        Équipe
      </h1>

      {canManage && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Inviter un membre</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="flex gap-2">
              <Input
                type="email"
                placeholder="email@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" disabled={inviting}>
                <UserPlus className="h-4 w-4" />
                Inviter
              </Button>
            </form>
            {error && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {data?.members.map((member) => (
          <Card key={member.userId}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">{member.name ?? member.email}</p>
                <p className="text-xs text-slate-500">{member.email}</p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-2">
                  <select
                    value={member.role}
                    onChange={(e) => onRoleChange(member.userId, e.target.value as Member['role'])}
                    className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                  >
                    <option value="OWNER">Propriétaire</option>
                    <option value="ADMIN">Admin</option>
                    <option value="MEMBER">Membre</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemove(member.userId)}
                    className="cursor-pointer text-slate-400 hover:text-red-600"
                    aria-label="Retirer ce membre"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className="text-sm text-slate-500">{member.role}</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/w/[orgSlug]/team/page.tsx"
git commit -m "feat(workspace): add team page with invite, role change, and removal"
```

---

### Task 19: Update login/signup/verify-email redirects and settings back-link

**Files:**
- Modify: `frontend/src/app/login/page.tsx`
- Modify: `frontend/src/app/signup/page.tsx`
- Modify: `frontend/src/app/verify-email/page.tsx`
- Modify: `frontend/src/app/settings/page.tsx`

**Interfaces:**
- Consumes: nothing new (uses `router.push`, already-imported `useRouter`).

- [ ] **Step 1: Update `login/page.tsx`**

Replace the line `router.push('/directory');` (inside `onSubmit`) with `router.push('/onboarding');`.

Replace the constant `const googleSignInHref = '/api/auth/oauth/google/start?next=/directory';` with:

```ts
const googleSignInHref = '/api/auth/oauth/google/start?next=/onboarding';
```

- [ ] **Step 2: Update `signup/page.tsx`**

`signup/page.tsx` redirects to `/verify-email?email=...` on success today — that flow is unaffected (verify-email is the next hop, not the final one). Only update its Google sign-in href the same way as login:

Replace `const googleSignInHref = '/api/auth/oauth/google/start?next=/directory';` with:

```ts
const googleSignInHref = '/api/auth/oauth/google/start?next=/onboarding';
```

- [ ] **Step 3: Update `verify-email/page.tsx`**

Replace the line `router.push('/directory');` (inside the `verify` function) with `router.push('/onboarding');`.

- [ ] **Step 4: Update `settings/page.tsx`**

Replace:

```tsx
      <Link href="/profile" className="text-center text-sm text-slate-600 hover:underline">
        Retour au profil
      </Link>
```

with:

```tsx
      <Link href="/onboarding" className="text-center text-sm text-slate-600 hover:underline">
        Retour à mon espace de travail
      </Link>
```

(`/onboarding` redirects to the user's first workspace dashboard when one exists, so this always lands somewhere valid without needing the current slug.)

- [ ] **Step 5: Run typecheck, lint, and the full test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: Manual smoke check**

With `pnpm dev` running, log in with an existing test account and confirm you land on `/onboarding` (and then the dashboard, if a workspace already exists).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/login/page.tsx frontend/src/app/signup/page.tsx frontend/src/app/verify-email/page.tsx frontend/src/app/settings/page.tsx
git commit -m "feat(workspace): point post-auth redirects at /onboarding instead of the removed /directory"
```

---

### Task 20: Rewrite the homepage

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `@/contexts/AuthContext` (already used by the current homepage).

- [ ] **Step 1: Replace the homepage content**

Replace the full contents of `frontend/src/app/page.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { FolderKanban, ListChecks, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            CoFound Africa
          </span>
          <nav className="flex items-center gap-3">
            {!loading && user ? (
              <Link href="/onboarding" className={buttonVariants({ size: 'sm' })}>
                Ouvrir mon espace de travail
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Se connecter
                </Link>
                <Link href="/signup" className={buttonVariants({ size: 'sm' })}>
                  Créer un compte
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="mx-auto flex max-w-3xl flex-1 flex-col items-center px-4 py-20 text-center sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          Gérez vos projets d&rsquo;équipe, simplement
        </h1>
        <p className="mt-4 max-w-xl text-lg text-slate-600">
          CoFound Africa est l&rsquo;espace de travail de votre équipe : projets, tâches et
          échéances au même endroit.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {!loading && user ? (
            <Link href="/onboarding" className={buttonVariants({ size: 'lg' })}>
              Ouvrir mon espace de travail
            </Link>
          ) : (
            <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
              Commencer gratuitement
            </Link>
          )}
        </div>

        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <FolderKanban className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Projets</p>
              <p className="text-sm text-slate-600">
                Organisez le travail de votre équipe par projet.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <ListChecks className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Tâches</p>
              <p className="text-sm text-slate-600">
                Assignez, suivez et terminez vos tâches sans effort.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <Users className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Équipe</p>
              <p className="text-sm text-slate-600">
                Invitez vos collègues et travaillez ensemble.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Run the full validation gate**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all green — this is the last task, so this run validates the whole sub-project together.

- [ ] **Step 3: Run the build**

Run: `cd frontend && pnpm build`
Expected: succeeds.

- [ ] **Step 4: Manual end-to-end smoke check**

With `pnpm dev` running: visit `/`, sign up a new account, verify email, land on `/onboarding`, create a workspace, land on the dashboard, create a project, open it, add a task, cycle its status, visit "Mes tâches", visit "Équipe", invite a second (pre-existing) test account by email, change its role, remove it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(workspace): rewrite homepage to pitch the project-management product"
```
