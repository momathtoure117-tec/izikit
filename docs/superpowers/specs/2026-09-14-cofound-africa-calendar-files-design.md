# CoFound Africa — Calendar + Documents/Files — Design Spec

## Context

Sub-project 1 (Fondations + Projets & Tâches) shipped and merged to `main`. This is
sub-project 2 of the larger workspace-tool build-out, covering the two remaining
"ESPACE DE TRAVAIL" sidebar items that don't depend on a new heavy subsystem:
**Calendrier** and **Documents/Fichiers**.

Per explicit user instruction, this spec is written directly (no interactive
brainstorming Q&A) — ambiguous calls are ruled on inline below and flagged as
`Ruling:`. The user has asked for the full original feature list to be built
without further check-ins; sub-projects continue to be scoped and sequenced by
the agent, matching the decomposition approach already validated in sub-project 1.

**Ruling — scope boundary**: the original mockup lists "Discussions" under both
ESPACE DE TRAVAIL and "Discussions de projet" under COLLABORATION. Both are
message-thread concepts and belong with the rest of Collaboration (Messagerie,
Notes, Mentions, Activité récente), which needs shared infrastructure (real-time
transport, a proper event log). Deferring all discussion/messaging to sub-project
3 keeps this slice coherent and appropriately sized.

## Goals

- A user can see a calendar view of their workspace: task due dates (read-only,
  derived from existing `Task.dueAt`) merged with ad-hoc calendar events they or
  teammates create directly (meetings, deadlines not tied to a specific task).
- A user can attach files to a project (uploaded via the starter's existing
  Cloudinary pipeline) and see all of a workspace's files in one place.

## Non-goals (deferred)

- Recurring calendar events, external calendar sync (Google Calendar, ICS export).
- Per-task file attachments (only project-level, for this slice — a task-level
  attachment is a small, obvious follow-up once the pattern exists).
- File versioning, folders/nesting, sharing links outside the workspace.
- Real-time updates — same as sub-project 1, plain fetch/refresh.

## Data model

Two new models.

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

**Ruling — reuse `FileUpload`, don't duplicate it**: the starter already has a
generic `FileUpload` model (`id, userId, key` [Cloudinary public_id],
`filename, mimeType, sizeBytes, createdAt`), populated by the existing
`POST /api/upload` route on every upload regardless of feature. `Document` is
the workspace-specific "this upload is attached to this project" join — it
references `FileUpload` by id (`fileUploadId`, `@unique` — one Document per
upload) rather than re-storing `filename`/`mimeType`/`sizeBytes`/the
Cloudinary public id. The one field genuinely worth storing on `Document`
itself is `url` (Cloudinary's `secure_url`), because `FileUpload` does NOT
persist it — `/api/upload`'s response includes `url` only in that single
response payload, reconstructed from Cloudinary's own reply, never written to
the `FileUpload` row. The client-side flow is therefore: upload to
`/api/upload` (existing route, unchanged) → get back `{ id, url, filename,
... }` → call `POST .../documents` with `{ fileUploadId: id, url }` to attach
it to a project. `FileUpload` gains a back-relation `document Document?`
(optional — most uploads, e.g. avatars, never become a Document).

## API routes

All routes: `export const runtime = 'nodejs'`, `withRequestContext`,
`verifyCsrf` on mutations, `requireOrgRole('MEMBER')` unless noted.

**Calendar**
- `POST /api/organizations/[orgId]/calendar-events` — create
- `GET /api/organizations/[orgId]/calendar-events?month=YYYY-MM` — list events
  whose `startAt` falls in that month, plus (merged into the same response,
  under a separate key) tasks with `dueAt` in that month — one call for the
  whole month view: `{ events: [{id,title,description,startAt,endAt}],
  taskDeadlines: [{id,title,dueAt,project:{id,name}}] }`
- `DELETE /api/organizations/[orgId]/calendar-events/[eventId]` — only the
  creator or an ADMIN/OWNER may delete (mirrors no other precedent in this
  codebase exactly, but matches the spirit of `requireOrgRole` + an ownership
  check pattern already used nowhere else — **Ruling**: creator-or-admin,
  checked in the route body after `requireOrgRole('MEMBER')` gates read access)

**Documents**
- `POST /api/organizations/[orgId]/projects/[projectId]/documents` — body
  `{ fileUploadId, url }` (the client uploads to `/api/upload` first — existing
  route, unchanged — then calls this to attach the resulting upload to a
  project). Validates `fileUploadId` refers to a `FileUpload` row owned by the
  calling user (`FileUpload.userId === auth.user.sub`) and not already
  attached to a Document (the `@unique` constraint enforces this at the DB
  level; the route checks first for a clean 409, e.g. `ALREADY_ATTACHED`,
  rather than surfacing a raw P2002)
- `GET /api/organizations/[orgId]/documents` — all documents across the
  workspace's projects, each annotated with `project: {id, name}` and the
  joined `fileUpload: {filename, mimeType, sizeBytes}`, for the "Fichiers" page
- `GET /api/organizations/[orgId]/projects/[projectId]/documents` — documents
  scoped to one project, for a "Documents" tab on the project detail page
- `DELETE /api/organizations/[orgId]/documents/[documentId]` — uploader or
  ADMIN/OWNER only (same ruling as calendar events). Attempts
  `cloudinary.uploader.destroy(fileUpload.key)` first (best-effort — catch and
  log a warning on failure, do NOT abort the deletion), then deletes the
  `Document` row and its `FileUpload` row. An orphaned Cloudinary asset is a
  cheap, recoverable cost; a Document row that can never be deleted because
  Cloudinary is briefly unreachable is not acceptable.

## Error codes (new)

`EVENT_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `FORBIDDEN_NOT_OWNER` (creator/uploader
check failure, 403), reusing `VALIDATION_FAILED` for Zod failures.

## Pages & navigation

- `/w/[orgSlug]/calendar` — month-grid view (prev/next month controls), each
  day cell lists that day's events + task deadlines; a "+ Nouvel événement"
  button opens an inline form (title, description, start date/time, optional
  end date/time).
- `/w/[orgSlug]/files` — flat list of all workspace documents, each row shows
  file name, parent project (linked), uploader, upload date, a download link
  (the Cloudinary URL directly), and a delete button (visible only to the
  uploader or an ADMIN/OWNER).
- Project detail page (`/w/[orgSlug]/projects/[projectId]`) gains a
  "Documents" section below the task list: an upload button + a list of that
  project's documents (same row shape as the Fichiers page, minus the project
  column).
- Sidebar gains two new items under ESPACE DE TRAVAIL, in this position:
  Tableau de bord, Projets, Calendrier, Mes tâches, Équipe, Fichiers (matches
  the original mockup's ordering, adapted for the items that actually exist —
  "Discussions" stays omitted until sub-project 3).

Icons: lucide-react (`Calendar` / `FileText` or similar), matching the
existing indigo/slate design system.

## Error handling / edge cases

- Deleting a project cascades to its `Document` rows (`onDelete: Cascade`) —
  the underlying Cloudinary assets are NOT cleaned up by the cascade (a DB
  cascade can't call an external API); **Ruling**: acceptable for this slice,
  matches the "cheap orphaned asset over blocked deletion" principle above —
  a future cron (`api/cron/orphaned-asset-purge`, following the existing cron
  pattern) could reconcile this later, out of scope now.
- Calendar month query: `month` param validated as `YYYY-MM`; invalid format
  → 400 `VALIDATION_FAILED`.
- Upload flow: the existing `/api/upload` route already enforces
  `UPLOAD_ALLOWED_MIME` + magic-byte sniffing + a size cap — this spec adds no
  new upload validation, only the "record it as a Document" step after.

## Testing

Vitest unit tests per route handler, matching sub-project 1's conventions:
auth check, org-role check, Zod validation, ownership-check business logic,
Cloudinary-destroy-called-before-delete (mocked).

## Global constraints (carried into the plan)

- `export const runtime = 'nodejs'` on every route handler.
- `verifyCsrf(req)` on every mutating route, checked before `requireOrgRole`.
- `if (auth instanceof NextResponse) return auth;` — no cast, ever.
- Every content page: `notFound` branch (via the existing shared
  `WorkspaceNotFound` component from sub-project 1's final fix round) checked
  before loading/error/data branches; loading guard is
  `if (wsLoading || loading || !data)`; `error` from `useApi` surfaced via
  `Alert variant="destructive"` + retry, checked before the loading fallback.
- Any mutation that should update a page's list calls `refresh()` from
  `useApi` in its success path only (never in `catch`) — this was a recurring,
  real bug class in sub-project 1's page-level tasks; do not repeat it.
- `Project`/`Task`/`Organization`/`OrganizationMember` names stay as-is
  (existing rule); new models `CalendarEvent`/`Document` follow the same
  `String` (not Prisma enum) convention were an enum-like field ever needed —
  none is needed in this slice.
