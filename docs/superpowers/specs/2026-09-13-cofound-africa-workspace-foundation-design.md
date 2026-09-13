# CoFound Africa — Workspace Foundation + Projects & Tasks — Design Spec

## Context

CoFound Africa currently ships a co-founder matching directory (`FounderProfile`,
unlock/order flow, admin moderation). The product is pivoting: the name
"CoFound Africa" stays, but the product becomes a team project-management and
collaboration tool (Asana/ClickUp/Monday-style) — workspaces, projects, tasks,
and (in later sub-projects) messaging, calendar, notes, time tracking, and
billing.

This spec covers the **first sub-project**: the technical foundation
(workspace data model, navigation shell, onboarding) plus the smallest
end-to-end useful slice (projects and tasks) that makes the app actually
usable. Later sub-projects (each with its own spec → plan → implementation
cycle) will add: Team & Members management UI, Collaboration (messaging,
discussions, notes, mentions), Calendar, Suivi (stats, goals, time tracking,
reports), and advanced Settings (security, integrations, billing).

## Goals

- A user can sign up, create a workspace, invite a teammate (by email of an
  existing account), create projects, create tasks, assign tasks, and see a
  dashboard summarizing all of it.
- Reuse the starter's existing multi-tenancy primitives (`Organization`,
  `OrganizationMember`, `requireOrgRole`) rather than building parallel
  workspace infrastructure.
- Remove the now-unused co-founder-matching domain cleanly (no dead code, no
  orphaned tests), following `PRUNING.md`.

## Non-goals (deferred to later sub-projects)

- Real-time updates (Ably) — v1 uses plain fetch/refresh, matching the rest
  of the app today.
- Per-project membership (all workspace members see all projects).
- Task priority, long-form description, sub-tasks, custom per-project
  statuses/Kanban columns.
- A dedicated activity-log subsystem — "recent activity" is derived from
  `updatedAt` sort order, not a stored event log.
- Invitation-by-email-for-non-existing-accounts (invite only works against
  an already-registered email in v1).
- Messaging, discussions, notes, mentions, calendar, time tracking, stats,
  goals, reports, security settings, integrations, billing — each becomes
  its own future sub-project.

## Data model

Reuses the existing generic models `Organization` / `OrganizationMember`
(CLAUDE.md forbids renaming generic models — the Prisma model names stay as
they are; application code and UI copy call them "workspace" /
"espace de travail").

Two new models:

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
  organizationId String       // denormalized from project.organizationId — enables
                               // the indexed "my tasks across all projects" query
                               // and direct org-scoped authorization without a join.
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

`Project.status` and `Task.status` follow the existing convention seen on
`FounderProfile.status` — a plain `String` with an enum-like comment, not a
Prisma enum.

Project "progression" (% complete) is computed at read time
(`DONE tasks / total tasks`), never stored, to avoid a field that can drift
out of sync.

## API routes

All routes: `export const runtime = 'nodejs'`, `withRequestContext`,
`verifyCsrf` on mutations, `requireOrgRole` for org-scoped routes.

**Workspaces**
- `POST /api/organizations` — create (generates slug via the existing
  `lib/server/slug.ts` helper; creates `Organization` + an OWNER
  `OrganizationMember` row in one transaction)
- `GET /api/organizations` — list the caller's workspaces (for the sidebar
  switcher)
- `GET /api/organizations/[orgId]` — detail (`requireOrgRole('MEMBER')`)
- `GET /api/organizations/[orgId]/members` — list members
- `POST /api/organizations/[orgId]/members` — invite by email of an
  existing account (`requireOrgRole('ADMIN')`); 404
  `USER_NOT_FOUND` if no account matches the email
- `PATCH /api/organizations/[orgId]/members/[userId]` — change role
  (`requireOrgRole('ADMIN')`; refuses to demote the last OWNER, mirroring
  the existing SUPERADMIN-demotion guard)
- `DELETE /api/organizations/[orgId]/members/[userId]` — remove a member
  (`requireOrgRole('ADMIN')`; refuses to remove the last OWNER)

**Projects** (`requireOrgRole('MEMBER')` unless noted)
- `POST /api/organizations/[orgId]/projects` — create
- `GET /api/organizations/[orgId]/projects` — list, each row annotated with
  `taskCounts: { total, done }` for the progress bar
- `GET /api/organizations/[orgId]/projects/[projectId]` — detail + its tasks
- `PATCH /api/organizations/[orgId]/projects/[projectId]` — update
  name/description/status
- `DELETE /api/organizations/[orgId]/projects/[projectId]`

**Tasks**
- `POST /api/organizations/[orgId]/projects/[projectId]/tasks` — create
- `GET /api/organizations/[orgId]/tasks?assignee=me` — cross-project "my
  tasks" (uses the `[organizationId, assigneeId]` index); `assignee` query
  param is currently only ever `me` (the authed user) — no arbitrary-user
  lookup in v1
- `PATCH /api/organizations/[orgId]/tasks/[taskId]` — update
  title/status/assigneeId/dueAt
- `DELETE /api/organizations/[orgId]/tasks/[taskId]`

**Dashboard**
- `GET /api/organizations/[orgId]/dashboard` — one aggregated response:
  `activeProjectsCount`, `tasksInProgressCount`, `tasksDoneCount`,
  `memberCount`, `upcomingDeadlines` (tasks with `dueAt` in the next 7 days,
  ascending), `recentActivity` (projects + tasks merged, sorted by
  `updatedAt` desc, capped at 10), `projectsProgress` (active projects with
  their `done/total` counts). One call instead of the client firing 6
  separate requests.

## Error codes (new)

`ORG_ROLE_INSUFFICIENT` already exists. New: `USER_NOT_FOUND` (invite target
not registered), `PROJECT_NOT_FOUND`, `TASK_NOT_FOUND`, `LAST_OWNER` (can't
demote/remove the last OWNER), `VALIDATION_FAILED` (Zod, existing
convention). Frontend switches on `ApiError.code`, never on `.message`.

No admin-audit-log entries for these routes — `logAdminAction` stays scoped
to `/api/admin/*` as today; workspace/project/task mutations are ordinary
user actions, not back-office actions.

## Pages & navigation

Routes (workspace slug in the URL):
- `/onboarding` — create your first workspace. A signed-in user with zero
  workspaces is redirected here (checked via `GET /api/organizations`
  returning an empty list).
- `/w/[orgSlug]/dashboard`
- `/w/[orgSlug]/projects`
- `/w/[orgSlug]/projects/[projectId]`
- `/w/[orgSlug]/tasks` — "Mes tâches"
- `/w/[orgSlug]/team`

**Sidebar scope for this sub-project**: workspace switcher at the top
("Mon entreprise ▾" + "Créer un espace de travail"), then only the
ESPACE DE TRAVAIL section's implemented items: Tableau de bord, Projets,
Tâches, Mes tâches, Équipe. The COLLABORATION / SUIVI / PARAMÈTRES sections
from the original mockup are deliberately omitted until their own
sub-projects ship — no dead links, per the lesson learned from the old
homepage having no working navigation.

Icons: lucide-react throughout (no emoji icons), matching the existing
indigo/slate design system and shared `components/ui/*` primitives
(`Button`, `Card`, `Badge`, `Input`, `Textarea`, `Label`, `Alert`).

## Dashboard content

- Header: greeting icon + "Bonjour" + "Voici ce qui se passe dans votre
  espace de travail aujourd'hui."
- Actions: "+ Nouveau projet" / "+ Nouvelle tâche" (open a simple form —
  modal or inline card, decided at implementation time)
- Summary cards: Projets actifs, Tâches en cours, Tâches terminées, Membres
  de l'équipe
- "Échéances à venir": tasks due within 7 days, sorted ascending
- "Activité récente": most-recently-updated projects/tasks (no dedicated
  activity log, per Non-goals)
- "Progression des projets": a progress bar per active project

## Removal of the old domain (PRUNING.md)

Delete: `FounderProfile`, `ProfileUnlock` Prisma models and their migration;
`/api/profiles/*`, `/api/admin/profiles/*` routes (and tests); pages
`profile/`, `directory/`, `directory/[id]/`, `orders/[id]/success`,
`orders/[id]/failed`, `admin/profiles/`. Follow the 9-step PRUNING.md
protocol (`surgical_edits` before deletions, Prisma schema cleanup,
`.planning/features.json` update, tripwire test check) and the
`pnpm format && lint && typecheck && test && build` gate before commit.
`Order`/`Withdrawal`/payments infrastructure stays (generic, may be reused
for future billing).

## Updates to existing pages

- **Post-auth redirect**: `login/page.tsx`, `signup/page.tsx`, and
  `verify-email/page.tsx` currently `router.push('/directory')`, a route
  this spec removes. New logic: call `GET /api/organizations`; if empty,
  push `/onboarding`; otherwise push `/w/[firstOrgSlug]/dashboard`.
- **Homepage** (`app/page.tsx`): currently pitches co-founder matching
  ("Trouvez votre co-fondateur en Afrique"). Rewritten as part of this
  sub-project's implementation to pitch the project-management product
  instead (same nav-bar pattern: Se connecter / Créer un compte when
  logged out; a workspace-aware link — "Ouvrir mon espace de travail" to
  the user's first workspace dashboard — when logged in), keeping the
  "CoFound Africa" name.
- **Google OAuth `next` param** (`login/page.tsx`,
  `signup/page.tsx`): currently hardcoded to `next=/directory`. Updated to
  `next=/onboarding` — the destination page itself does the
  has-a-workspace redirect check on load, so a returning user with an
  existing workspace still lands correctly (an extra hop through
  `/onboarding`, not a broken flow).

## Testing

Vitest unit tests per route handler, matching existing conventions: auth
check, org-role check, Zod validation, business logic (e.g., last-OWNER
guard, cross-project task query, dashboard aggregation). No new test
framework or harness.

## Error handling / edge cases

- Creating a workspace: the creator becomes OWNER atomically (same
  transaction as the `Organization` row), so there's never a workspace
  with zero OWNER members.
- Removing/demoting the last OWNER: rejected with `LAST_OWNER`, mirroring
  the existing SUPERADMIN-demotion guard in `/api/admin/users/[id]/role`.
- Deleting a project cascades to its tasks (`onDelete: Cascade`).
- Unassigning a deleted user's tasks: `assigneeId` becomes `null`
  (`onDelete: SetNull`) rather than deleting the task.
