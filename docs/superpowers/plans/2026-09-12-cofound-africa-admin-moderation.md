# CoFound Africa — Admin Profile Moderation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/profiles`, a standalone admin screen to review, suspend, and republish `FounderProfile` records via the already-merged backend admin API.

**Architecture:** A single client-rendered page (`frontend/src/app/admin/profiles/page.tsx`) with no shared admin layout. It self-guards via `GET /api/admin/me`, lists profiles via `GET /api/admin/profiles` with a manual `load(reset)` fetch pattern (not the `useApi` hook — see Global Constraints), and mutates status via `PATCH /api/admin/profiles/[id]/status`. No backend changes.

**Tech Stack:** Next.js 16 App Router, React, TypeScript strict, Tailwind v4. Existing frontend primitives only: `@/lib/api` (`api`, `ApiError`), `@/contexts/ToastContext` (`useToast`), `next/navigation` (`useRouter`).

**Spec:** [docs/superpowers/specs/2026-09-12-cofound-africa-admin-moderation-design.md](../specs/2026-09-12-cofound-africa-admin-moderation-design.md)

## Global Constraints

- No backend changes. `GET /api/admin/profiles`, `PATCH /api/admin/profiles/[id]/status`, and `GET /api/admin/me` are used exactly as they exist today — do not modify any file under `frontend/src/app/api/admin/**` or `frontend/src/lib/server/**`.
- Do **not** modify the `can` capability list in `frontend/src/app/api/admin/me/route.ts` — it is a locked contract (`D-ADMIN-04`). The page only checks that the `GET /api/admin/me` call succeeds (200); it never reads `can`.
- Use the manual `load(reset: boolean)` fetch pattern from `examples/frontend-pages/admin/users.tsx` — **not** the `useApi` hook from `@/lib/useApi`. This is a deliberate choice: the Phase 1 founder-facing UI's final review found a class of timing bugs in `useApi` (its `loading` state is stale on the render where a guard condition flips). The `load(reset)` pattern sidesteps this by construction.
- Mutating calls go through `api()` from `@/lib/api` (never raw `fetch`) so CSRF is attached automatically. Branch on `ApiError.code`, never on `ApiError.message` (`err.code` is derived from `body.error`, a stable backend string — see `frontend/src/lib/api.ts:121`).
- No automated tests for this page. This starter does not test UI pages with Vitest (`examples/frontend-pages/*` have no `.test.tsx` files, and the Phase 1 founder-facing UI shipped the same way) — manual verification only, per Task 3.
- Copy is in French. Use neutral/imperative phrasing ("Confirmer", "La raison est requise.") rather than "tu"/"vous" — this is a professional admin back-office context, distinct from the founder-facing app's "tu" register, and neutral phrasing sidesteps the tu/vous inconsistency the founder UI's final review flagged.
- Tailwind only, no shadcn/ui, minimalist black/white/gray palette — consistent with `examples/frontend-pages/admin/users.tsx`.
- `pnpm format && pnpm lint && pnpm typecheck` must stay green after every task.

---

### Task 1: Read-only moderation screen — guard, list, filter, pagination

**Files:**
- Create: `frontend/src/app/admin/profiles/page.tsx`

**Interfaces:**
- Produces: `AdminProfile` interface (`id, userId, bio, city, sector, skills, hasIdea, availableToCofound, status, createdAt, user: { email }`), `ListResponse` interface (`items: AdminProfile[], nextCursor: string | null`), `StatusFilter` type (`'PUBLISHED' | 'SUSPENDED' | 'DRAFT'`), `STATUS_LABEL` constant — Task 2 extends this same file and reuses all of these exactly as named here.
- Consumes: `api` from `@/lib/api` (no other project code).

This task delivers a fully working, independently reviewable screen: an admin can open it, see it redirect non-admins, and browse/filter/paginate the profile list. No suspend/republish actions yet (Task 2).

- [ ] **Step 1: Create the page with access guard, list fetch, status filter, and pagination**

Create `frontend/src/app/admin/profiles/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type StatusFilter = 'PUBLISHED' | 'SUSPENDED' | 'DRAFT';

const STATUS_LABEL: Record<StatusFilter, string> = {
  PUBLISHED: 'Publié',
  SUSPENDED: 'Suspendu',
  DRAFT: 'Brouillon',
};

interface AdminProfile {
  id: string;
  userId: string;
  bio: string;
  city: string;
  sector: string;
  skills: string[];
  hasIdea: boolean;
  availableToCofound: boolean;
  status: StatusFilter;
  createdAt: string;
  user: { email: string };
}

interface ListResponse {
  items: AdminProfile[];
  nextCursor: string | null;
}

export default function AdminProfilesPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PUBLISHED');
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await api('/api/admin/me');
        if (!cancelled) setAuthorized(true);
      } catch {
        if (!cancelled) router.replace('/');
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function load(reset: boolean) {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      params.set('status', statusFilter);
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/profiles?${params.toString()}`);
      setProfiles((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authorized) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, statusFilter]);

  if (!checked || !authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Vérification de l&apos;accès…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">Modération des profils</h1>

      <div className="flex gap-2 text-sm">
        {(['PUBLISHED', 'SUSPENDED', 'DRAFT'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-md border px-3 py-2 ${
              statusFilter === s ? 'border-black bg-black text-white' : 'border-gray-300'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>Impossible de charger la liste des profils.</p>
          <button type="button" onClick={() => void load(true)} className="self-start underline">
            Réessayer
          </button>
        </div>
      )}

      {!error && !loading && profiles.length === 0 && (
        <p className="text-sm text-gray-600">Aucun profil ne correspond à ce filtre.</p>
      )}

      {profiles.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="py-2">Email</th>
              <th>Bio</th>
              <th>Ville</th>
              <th>Secteur</th>
              <th>Compétences</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Créé le</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-gray-100">
                <td className="py-2 font-medium">{p.user.email}</td>
                <td className="max-w-xs text-gray-600">
                  <span className="line-clamp-2">{p.bio}</span>
                </td>
                <td className="text-gray-600">{p.city}</td>
                <td className="text-gray-600">{p.sector}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {p.skills.map((s) => (
                      <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="flex flex-col gap-1">
                    {p.hasIdea && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                        A une idée
                      </span>
                    )}
                    {p.availableToCofound && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        Dispo pour co-fonder
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      p.status === 'PUBLISHED'
                        ? 'bg-green-100 text-green-700'
                        : p.status === 'SUSPENDED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className="text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={loading}
          className="self-start rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Chargement…' : 'Charger plus'}
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles and type-checks**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass with zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/profiles/page.tsx
git commit -m "feat(admin-profiles-ui): add read-only moderation list with filter and pagination"
```

---

### Task 2: Suspend and republish actions

**Files:**
- Modify: `frontend/src/app/admin/profiles/page.tsx` (full replacement — extends Task 1's file)

**Interfaces:**
- Consumes: `AdminProfile`, `ListResponse`, `StatusFilter`, `STATUS_LABEL`, `AdminProfilesPage` component body from Task 1.
- Produces: nothing further downstream — this is the last task before manual verification.

This task adds the Actions column: a "Suspendre" button that expands an inline required-reason field, and a "Republier" button for suspended profiles. Both call `PATCH /api/admin/profiles/[id]/status` and handle `VALIDATION_FAILED`/`PROFILE_NOT_FOUND`/generic errors distinctly, per the spec.

- [ ] **Step 1: Replace the file with the full version including actions**

Replace the entire contents of `frontend/src/app/admin/profiles/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import { api, ApiError } from '@/lib/api';

type StatusFilter = 'PUBLISHED' | 'SUSPENDED' | 'DRAFT';

const STATUS_LABEL: Record<StatusFilter, string> = {
  PUBLISHED: 'Publié',
  SUSPENDED: 'Suspendu',
  DRAFT: 'Brouillon',
};

interface AdminProfile {
  id: string;
  userId: string;
  bio: string;
  city: string;
  sector: string;
  skills: string[];
  hasIdea: boolean;
  availableToCofound: boolean;
  status: StatusFilter;
  createdAt: string;
  user: { email: string };
}

interface ListResponse {
  items: AdminProfile[];
  nextCursor: string | null;
}

export default function AdminProfilesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [checked, setChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PUBLISHED');
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await api('/api/admin/me');
        if (!cancelled) setAuthorized(true);
      } catch {
        if (!cancelled) router.replace('/');
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function load(reset: boolean) {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      params.set('status', statusFilter);
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/profiles?${params.toString()}`);
      setProfiles((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authorized) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, statusFilter]);

  function startSuspend(id: string) {
    setExpandedReasonId(id);
  }

  function cancelSuspend(id: string) {
    setExpandedReasonId((current) => (current === id ? null : current));
    setActionError((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function applyStatusChange(
    id: string,
    status: 'PUBLISHED' | 'SUSPENDED',
    reason?: string,
  ) {
    setSubmitting((prev) => ({ ...prev, [id]: true }));
    try {
      await api(`/api/admin/profiles/${id}/status`, {
        method: 'PATCH',
        body: reason ? { status, reason } : { status },
      });
      toast(status === 'SUSPENDED' ? 'Profil suspendu.' : 'Profil republié.', 'success');
      setExpandedReasonId((current) => (current === id ? null : current));
      setActionError((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (status === 'SUSPENDED') {
        setReasonDraft((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      if (status !== statusFilter) {
        setProfiles((prev) => prev.filter((p) => p.id !== id));
      } else {
        setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'VALIDATION_FAILED':
            setActionError((prev) => ({
              ...prev,
              [id]: 'La raison doit contenir entre 1 et 500 caractères.',
            }));
            break;
          case 'PROFILE_NOT_FOUND':
            toast("Ce profil n'existe plus.", 'error');
            setProfiles((prev) => prev.filter((p) => p.id !== id));
            break;
          default:
            toast('Une erreur est survenue, réessaie.', 'error');
        }
      } else {
        toast('Erreur réseau, réessaie.', 'error');
      }
    } finally {
      setSubmitting((prev) => ({ ...prev, [id]: false }));
    }
  }

  function confirmSuspend(id: string) {
    const reason = (reasonDraft[id] ?? '').trim();
    if (reason.length < 1) {
      setActionError((prev) => ({ ...prev, [id]: 'La raison est requise.' }));
      return;
    }
    void applyStatusChange(id, 'SUSPENDED', reason);
  }

  function republish(id: string) {
    void applyStatusChange(id, 'PUBLISHED');
  }

  if (!checked || !authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Vérification de l&apos;accès…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">Modération des profils</h1>

      <div className="flex gap-2 text-sm">
        {(['PUBLISHED', 'SUSPENDED', 'DRAFT'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-md border px-3 py-2 ${
              statusFilter === s ? 'border-black bg-black text-white' : 'border-gray-300'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>Impossible de charger la liste des profils.</p>
          <button type="button" onClick={() => void load(true)} className="self-start underline">
            Réessayer
          </button>
        </div>
      )}

      {!error && !loading && profiles.length === 0 && (
        <p className="text-sm text-gray-600">Aucun profil ne correspond à ce filtre.</p>
      )}

      {profiles.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="py-2">Email</th>
              <th>Bio</th>
              <th>Ville</th>
              <th>Secteur</th>
              <th>Compétences</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Créé le</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 align-top">
                <td className="py-2 font-medium">{p.user.email}</td>
                <td className="max-w-xs text-gray-600">
                  <span className="line-clamp-2">{p.bio}</span>
                </td>
                <td className="text-gray-600">{p.city}</td>
                <td className="text-gray-600">{p.sector}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {p.skills.map((s) => (
                      <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="flex flex-col gap-1">
                    {p.hasIdea && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                        A une idée
                      </span>
                    )}
                    {p.availableToCofound && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        Dispo pour co-fonder
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      p.status === 'PUBLISHED'
                        ? 'bg-green-100 text-green-700'
                        : p.status === 'SUSPENDED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className="text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td className="min-w-[220px]">
                  {p.status === 'PUBLISHED' &&
                    (expandedReasonId === p.id ? (
                      <div className="flex flex-col gap-1">
                        <textarea
                          rows={2}
                          value={reasonDraft[p.id] ?? ''}
                          onChange={(e) =>
                            setReasonDraft((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          placeholder="Raison de la suspension"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        {actionError[p.id] && (
                          <span className="text-xs text-red-600">{actionError[p.id]}</span>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => confirmSuspend(p.id)}
                            disabled={submitting[p.id]}
                            className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {submitting[p.id] ? 'Envoi…' : 'Confirmer'}
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelSuspend(p.id)}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startSuspend(p.id)}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                      >
                        Suspendre
                      </button>
                    ))}
                  {p.status === 'SUSPENDED' && (
                    <button
                      type="button"
                      onClick={() => republish(p.id)}
                      disabled={submitting[p.id]}
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                    >
                      {submitting[p.id] ? 'Envoi…' : 'Republier'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={loading}
          className="self-start rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Chargement…' : 'Charger plus'}
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles and type-checks**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass with zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/profiles/page.tsx
git commit -m "feat(admin-profiles-ui): add suspend/republish actions with reason handling"
```

---

### Task 3: Verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full verification sweep**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all four pass. Baseline before this plan: 616/616 tests passing — this plan adds no automated tests (per Global Constraints), so the count should stay 616.

- [ ] **Step 2: Compile-smoke-check the new route under Turbopack**

This repo's sandboxed dev environment has no `DATABASE_URL`/`JWT_SECRET` configured, so `pnpm dev` cannot boot without a temporary env file — this is a known, pre-existing environment limitation (documented in the Phase 1 founder-facing UI's own verification task), not something to fix here. If a real environment with `DATABASE_URL`/`JWT_SECRET` is available, run `pnpm dev` and load `/admin/profiles` directly. If not (this sandbox), create a temporary git-ignored `frontend/.env.local` with placeholder values sufficient to pass boot validation:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/smoke_check_only
JWT_SECRET=smoke-check-fixture-jwt-secret-with-enough-entropy-32b
```

Start `pnpm dev`, curl `http://localhost:3000/admin/profiles`, confirm HTTP 200 with no compile errors or warnings in the dev server log tied to the new file. Then kill the dev server and delete `frontend/.env.local` — verify with `git status --short frontend/.env.local` that it leaves no trace.

- [ ] **Step 3: Report honestly**

The actual interactive walkthrough (the 7-step checklist in the spec's "Tests" section: non-admin redirect, filter switching, suspend with reason, republish, validation error, pagination) requires a real database and a real admin account, which this sandboxed environment does not have. Report exactly what was verified (compile-level checks) and what was not (the interactive checklist), per the same honesty standard applied to the Phase 1 founder-facing UI's own Task 6 — do not claim the interactive checklist was run if it wasn't.

- [ ] **Step 4: Final commit if any cleanup was needed**

If Step 2 left no artifacts (expected — `.env.local` is git-ignored and was deleted), there is nothing to commit. If `git status` shows anything unexpected, investigate before proceeding — do not discard unfamiliar changes without checking their origin.
