# CoFound Africa — Collaboration (Messagerie, Notes, Discussions de projet, Mentions, Notifications, Activité récente) — Design Spec

## Context

Sub-projects 1 (Fondations + Projets & Tâches) and 2 (Calendrier + Documents/Fichiers)
have shipped and merged to `main`. This is sub-project 3, covering the
COLLABORATION nav section from the original feature list: Messagerie,
Membres, Notes, Discussions de projet, Mentions, Activité récente.

Per the user's standing instruction, this spec is written directly (no
interactive brainstorming Q&A) — ambiguous calls are ruled on inline below
and flagged as `Ruling:`.

**Ruling — "Membres" needs no new work.** The original mockup lists
"Membres" under COLLABORATION, separately from "Équipe" under ESPACE DE
TRAVAIL. Both describe the same capability (see the team member list +
invite flow already shipped in sub-project 1's `/w/[orgSlug]/team` page,
backed by the existing `GET/POST /api/organizations/[orgId]/members`
routes). Building a second, near-identical page under a different name
would be pure duplication. This slice adds no "Membres" page.

**Ruling — Notifications backend already exists.** The starter ships a
complete, tested notifications backend (`GET/PATCH /api/notifications`,
`GET /api/notifications/count`, the `createNotification` helper, and
`NotificationPreferences`) with no frontend consumer yet. Since Mentions
(this slice) is the first feature to actually populate `Notification` rows
in this app, it makes sense to also ship the Notifications page in this
same slice — the two features share one data source and one API surface,
and deferring Notifications to a later sub-project would mean Mentions
produces rows nobody can see. "Notifications" (and "Sécurité" etc.) also
appear later, under PARAMÈTRES/SUIVI in the original list — this slice
covers only the notification *feed* page; advanced settings (email
preferences UI, security settings) stay deferred to that later sub-project.

## Goals

- A user can post messages in one shared, workspace-wide discussion channel
  ("Messagerie") and in a per-project discussion thread ("Discussions de
  projet"), reusing the same underlying model.
- A user can @mention a teammate in a message (via a picker, not free-text
  parsing — see Mention parsing below); the mentioned user receives a
  Notification.
- A user can view and mark-read their notifications, and view a
  mentions-only filtered subset.
- A user can create simple text notes, optionally tagged to a project.
- A user can see a merged, read-only "recent activity" feed spanning
  projects, tasks, documents, calendar events, messages, notes, and new
  members — synthesized at read time from existing data, no new write-path
  changes to already-shipped code.

## Non-goals (deferred)

- **Direct 1:1 or group DMs.** "Messagerie" here is one shared workspace
  channel, not a conversation list with per-user threads. **Ruling:** a
  real DM system needs participant management, per-conversation unread
  state, and a conversation list UI — a materially larger feature that can
  be its own future slice if requested. One shared channel + one thread per
  project matches the original mockup's flat nav item ("Messagerie" is a
  single sidebar entry, not a list of conversations) and covers the
  "team chat" need this app's users actually described.
- **Real-time updates.** CLAUDE.md explicitly recommends Ably for
  chat/real-time features and warns against hand-rolled polling loops in
  serverless. **Ruling:** deferring anyway, consistent with sub-projects
  1-2's established "plain fetch/refresh" pattern — wiring a new external
  service (Ably) requires the user's own API credentials, which is exactly
  the kind of external/credential dependency this project's stop-conditions
  reserve for an explicit ask. Shipping a working polling-based version now
  and upgrading to Ably later (a clean, additive swap behind the same
  message-list UI) is lower-risk than blocking this slice on new
  infrastructure.
- **Message/note editing or deletion in "Discussions"/"Messagerie".** Create
  + list only this slice. Editing chat history is a small, obvious
  follow-up once the pattern exists (Notes, by contrast, DOES get
  edit/delete — see below, since notes are a persistent reference document,
  not a chat log).
- **Rich text / markdown.** Messages and notes are plain text, rendered
  with `white-space: pre-wrap` to preserve line breaks. No markdown parser,
  no file attachments inside messages (Documents already covers file
  sharing, from sub-project 2).
- **Threaded replies.** Flat chronological list only, no reply-to-message.
- **Note folders, tags (beyond one optional project), or versioning.** Flat
  list, optionally associated with one project.
- **Message pagination / infinite scroll.** Each channel/thread loads its
  most recent 50 messages, newest-relevant window only. A heavier chat
  history browser is future work; 50 is a reasonable v1 bound and matches
  this app's general "keep it simple" precedent from sub-projects 1-2.
- **A persisted activity log.** The activity feed is computed at read time
  from existing timestamped rows already in the database (Project, Task,
  CalendarEvent, Document, Message, Note, OrganizationMember) — no new
  `ActivityEvent` table, no changes to any already-shipped mutation route.
  This is a deliberate risk-reduction choice: touching many already-tested
  routes across two prior sub-projects to add activity-logging calls would
  be broad, invasive, and disproportionate to the value for a v1 read-only
  feed.

## Data model

Two new models: `Message`, `Note`.

```prisma
model Message {
  id             String        @id @default(cuid())
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId      String?
  project        Project?      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  authorId       String
  author         User          @relation("MessageAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  body           String
  createdAt      DateTime      @default(now())

  @@index([organizationId, projectId, createdAt])
}

model Note {
  id             String        @id @default(cuid())
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId      String?
  project        Project?      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  authorId       String
  author         User          @relation("NoteAuthor", fields: [authorId], references: [id], onDelete: Restrict)
  title          String
  body           String
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([organizationId, projectId])
}
```

`projectId` is nullable on both: null `Message` = the general workspace
channel; a set `projectId` = that project's discussion thread. Same
nullable convention for `Note` (workspace-wide vs. project-tagged).

**Ruling — no denormalized mention list on `Message`.** Considered adding
`mentionedUserIds String[]` to `Message` for fast "who was mentioned here"
lookups, but the `Notification` table (see Mention parsing) is already the
single source of truth for "who was notified about what" — a second,
denormalized copy would need to stay in sync for no real benefit, since the
Mentions page reads `Notification`, never `Message`, for its list.

Back-relations: `Organization` gains `messages Message[]` and
`notes Note[]`; `Project` gains `messages Message[]` and `notes Note[]`;
`User` gains `messagesAuthored Message[] @relation("MessageAuthor")` and
`notesAuthored Note[] @relation("NoteAuthor")`.

`onDelete: Restrict` on both author relations matches the existing
`TaskCreator`/`DocumentUploader`/`CalendarEventCreator` precedent — a
message or note's author can't be hard-deleted while their content exists,
so removing a member from an org does NOT delete their message/note
history (`OrganizationMember` deletion is independent of `User` deletion in
this codebase; org removal ≠ account deletion).

## Mention parsing

**Ruling — picker-based, not free-text `@username` parsing.** `User` has
no `username` field (only `email` and an optional `name`), so there is no
stable, short token to parse out of free text. Instead: the compose UI's
"@" keystroke opens a dropdown of org members (fetched via the existing
`GET /api/organizations/[orgId]/members`, which already returns
`{userId, email, name, role}` for every member — no new route needed for
the picker's data). Selecting a member inserts a mention token into the
plain-text body: `@[Display Name](userId)`. The server extracts
`userId`s from that exact token shape via regex when creating the message,
validates each extracted id is still a member of the org (a member could
leave between typing and sending — **ruling:** silently drop non-member
ids rather than 400ing the whole message; the message body itself doesn't
need to change, only which mentions actually fire notifications), and
fires one notification per valid mentioned id via `createNotification`
immediately after the message row is created — a direct call, not an
outbox entry, because the outbox pattern in this codebase is specifically
for webhook-handler side effects (raw-body HMAC + Serializable tx
concerns) and does not apply to a plain authenticated mutation; every
other non-webhook notification in this codebase (`welcomeNotification`,
`paymentReceived`) already fires this way. `dedupeKey`:
`mention:${messageId}:${mentionedUserId}` (deterministic, at-most-once).

The client renders a message body by replacing every `@[Name](id)` token
with a styled `<span>` reading `@Name` — a small parse-and-render helper
function, not a rich text editor.

## API routes

All routes: `export const runtime = 'nodejs'`, `withRequestContext`,
`verifyCsrf` on mutations, `requireOrgRole('MEMBER')` unless noted.

**Messages**
- `POST /api/organizations/[orgId]/messages` — body `{ body, projectId? }`.
  When `projectId` is provided, validates it belongs to the org (404
  `PROJECT_NOT_FOUND` otherwise). Extracts and validates mentions (see
  above), fires notifications, returns `{ message: {id, body, authorId,
  authorName, createdAt} }` (201).
- `GET /api/organizations/[orgId]/messages?projectId=...` — omit
  `projectId` for the general channel, provide it for a project thread.
  Returns the 50 most recent messages, `orderBy: createdAt desc` then
  reversed server-side so the response is already oldest-to-newest (the
  order a chat UI renders top-to-bottom):
  `{ messages: [{id, body, authorId, authorName, createdAt}] }`.

**Notes**
- `POST /api/organizations/[orgId]/notes` — `{ title, body, projectId? }`
  → `{ note: {...} }` (201).
- `GET /api/organizations/[orgId]/notes` — all notes, newest first,
  `{ notes: [{id, title, body, authorId, authorName, project: {id,name} |
  null, createdAt, updatedAt}] }`.
- `PATCH /api/organizations/[orgId]/notes/[noteId]` — author-or-ADMIN/OWNER
  only, `{ title?, body? }` → updated note (200), or 403
  `FORBIDDEN_NOT_OWNER` / 404 `NOTE_NOT_FOUND`.
- `DELETE /api/organizations/[orgId]/notes/[noteId]` — author-or-ADMIN/OWNER
  only → 200 `{ success: true }` (NOT bare 204 — see the hard-won lesson
  from sub-project 2's final review: `frontend/src/lib/api.ts` throws on an
  empty-body 204 response, breaking every delete button silently. Every
  DELETE route in this plan returns `NextResponse.json({success:true},
  {status:200})`, never `new NextResponse(null, {status:204})`).

**Mentions** (no new route — extends the existing notifications route)
- `GET /api/notifications` gains an additive, optional `type` query
  param filter (backward compatible — omitting it behaves exactly as
  today). The Mentions page calls `GET /api/notifications?type=MENTION`.

**Activity**
- `GET /api/organizations/[orgId]/activity` — read-only. Runs parallel
  `findMany` queries (each `take: 10`, ordered by the relevant timestamp
  descending) against `Project` (`createdAt`), `Task` (`createdAt`),
  `CalendarEvent` (`createdAt`), `Document` (`createdAt`), `Message`
  (`createdAt`), `Note` (`createdAt`), and `OrganizationMember`
  (`createdAt`) — all scoped to the org. Maps each row to a common shape
  `{id, type, actorName, description, createdAt}` (e.g. `type: 'project'`,
  `description: 'a créé le projet "Site web"'`), merges all seven arrays,
  sorts by `createdAt` descending, returns the top 30:
  `{ activity: [...] }` (200).

**Notifications** (routes already exist and are unmodified except the
additive `type` filter above)
- `GET /api/notifications`, `PATCH /api/notifications`,
  `GET /api/notifications/count` — all pre-existing.

## Error codes (new)

`NOTE_NOT_FOUND`, `FORBIDDEN_NOT_OWNER` (reused from sub-project 2's
convention), reusing `VALIDATION_FAILED` and `PROJECT_NOT_FOUND`.

## Pages & navigation

- `/w/[orgSlug]/messages` — the general workspace channel: scrollable
  message list (oldest to newest) + a compose box with an "@"-triggered
  member picker.
- Project detail page (`/w/[orgSlug]/projects/[projectId]`) gains a
  "Discussions" section below Documents (added in sub-project 2) — same
  `Message`/compose/mention-picker component, scoped by `projectId`.
- `/w/[orgSlug]/notes` — flat list of notes (title, author, project tag if
  any, updated date), create/edit/delete, edit/delete gated to
  author-or-ADMIN/OWNER (mirrors the Documents-page permission-gating
  pattern from sub-project 2's final review fix).
- `/w/[orgSlug]/mentions` — notifications list filtered to `type=MENTION`,
  mark-read.
- `/w/[orgSlug]/notifications` — full notifications list (all types),
  mark-read (single item + mark-all-as-read), surfacing the pre-existing
  backend.
- `/w/[orgSlug]/activity` — the read-only synthesized recent-activity feed.
- Sidebar (`frontend/src/app/w/[orgSlug]/layout.tsx`): **ruling — introduce
  section headers.** Sub-projects 1-2 left the nav as one flat list (now 6
  items: Tableau de bord, Projets, Calendrier, Mes tâches, Équipe,
  Fichiers). Adding 4 more flat items (Messagerie, Notes, Mentions,
  Activité récente) would make a 10-item undifferentiated list, worse than
  the original mockup's sectioned sidebar (ESPACE DE TRAVAIL /
  COLLABORATION / SUIVI / PARAMÈTRES). This slice introduces a non-clickable
  section-header row above the existing items ("ESPACE DE TRAVAIL") and a
  second one before the new items ("COLLABORATION"), matching the mockup's
  actual structure — later sub-projects (Suivi, Paramètres) add their own
  headers the same way.
- A notification bell icon with an unread-count badge, in the workspace
  layout's header (not the sidebar nav list) — polls
  `GET /api/notifications/count` once on mount (no interval polling, matching
  the "plain fetch, no real-time" convention already established; the count
  refreshes naturally on next page navigation/reload). Clicking it links to
  `/w/[orgSlug]/notifications`.

Icons: lucide-react (`MessageSquare` for Messagerie, `StickyNote` for
Notes, `AtSign` for Mentions, `Activity` for Activité récente, `Bell` for
the notification icon), matching the existing indigo/slate design system.

## Error handling / edge cases

- Deleting a project cascades to its `Message` and `Note` rows (`onDelete:
  Cascade`) — consistent with `Document`'s precedent from sub-project 2.
- A message create for a `projectId` outside the caller's org → 404
  `PROJECT_NOT_FOUND` (org-boundary check, same convention as every route
  in sub-projects 1-2).
- Mention notification creation is fire-and-forget relative to the message
  response: if `createNotification` throws for a reason OTHER than the
  expected P2002 dedup (already handled inside the helper), the message
  itself has still been created successfully — the route does not roll
  back the message on a notification failure. **Ruling:** a lost mention
  notification is a much cheaper failure than losing the user's message
  text; wrap each `createNotification` call in try/catch, `log.warn` on
  unexpected failure, keep going.
- Every DELETE route added in this slice returns `NextResponse.json(
  {success:true}, {status:200})`, never a bare 204 — the sub-project 2
  final-review lesson applies globally, not just to that slice's routes.
- Every content page: `notFound` branch via the existing shared
  `WorkspaceNotFound` component, checked before loading/error/data
  branches; loading guard `if (wsLoading || loading || !data)`; `error`
  from `useApi` surfaced via `Alert variant="destructive"` + retry, checked
  before the loading fallback; any mutation that should update a page's
  list calls `refresh()` from `useApi` in its success path only.
- Delete/edit buttons on Notes are gated client-side to
  `note.authorId === user?.id || role === 'ADMIN' || role === 'OWNER'`,
  same pattern fixed into the Documents feature at the end of sub-project 2
  — applied proactively here from the start, not discovered via review.

## Testing

Vitest unit tests per route handler, matching sub-projects 1-2's
conventions: auth check, org-role check, Zod validation, ownership-check
business logic, mention-extraction-and-notification-firing (mocked
`createNotification`), org-boundary 404s.

## Global constraints (carried into the plan)

- `export const runtime = 'nodejs'` on every route handler.
- `verifyCsrf(req)` on every mutating route, checked before
  `requireOrgRole`.
- `if (auth instanceof NextResponse) return auth;` — no cast, ever.
- Every DELETE route returns `NextResponse.json({success:true},
  {status:200})` — never bare `204` (breaks `frontend/src/lib/api.ts`'s
  `response.json()` call on every successful delete; this was the HIGH
  finding from sub-project 2's final review, and it also affects two
  pre-existing routes outside this plan's scope — not this plan's job to
  fix those, but this plan must not introduce a third instance).
- Every content page: `notFound` branch via `WorkspaceNotFound`, checked
  before loading/error/data; loading guard
  `if (wsLoading || loading || !data)`; `error` from `useApi` surfaced via
  `Alert variant="destructive"` + retry, checked before the loading
  fallback.
- Any mutation that should update a page's list calls `refresh()` from
  `useApi` in its success path only (never in `catch`).
- Delete/edit affordances gated client-side to author-or-ADMIN/OWNER from
  the start (not as a follow-up fix) wherever ownership matters (Notes;
  Messages have no edit/delete this slice, so N/A there).
- Client-side delete-error handling surfaces `err.code === 
  'FORBIDDEN_NOT_OWNER'` as a French message via a small code→message map,
  never raw `err.message` — matching the `settings/page.tsx` /
  sub-project-2-final-fix convention.
- `Project`/`Task`/`Organization`/`OrganizationMember`/`FileUpload`/
  `CalendarEvent`/`Document` names stay as-is; new models `Message`/`Note`
  follow the same `String` (not Prisma enum) convention.
