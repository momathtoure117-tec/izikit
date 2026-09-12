# CoFound Africa — Phase 1 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 4 user-facing screens (profile edit, directory, profile detail + pay-per-unlock, payment return pages) that consume the already-merged Phase 1 API, in the starter's existing minimalist Tailwind style.

**Architecture:** Plain Next.js 16 App Router client pages under `frontend/src/app/{profile,directory,orders}/**`, built directly on the existing `useUser()` / `useToast()` / `api()` / `useApi()` primitives — no new libraries, no shared layout, no admin UI (deferred). A single small helper (`lib/pending-unlock.ts`) bridges the payment-redirect round-trip via `localStorage`, mirroring the pattern `lib/api.ts` already uses for the CSRF token.

**Tech Stack:** Next.js 16 App Router (Client Components), React 19, Tailwind v4 (no shadcn/ui — matches the starter's existing reference pages).

**Spec:** [docs/superpowers/specs/2026-09-12-cofound-africa-phase1-ui-design.md](../specs/2026-09-12-cofound-africa-phase1-ui-design.md)

**Spec refinement discovered during planning:** the spec's error-handling section says the unlock button should read a `Retry-After` value and disable itself for that many seconds. `lib/api.ts`'s `ApiError` (a protected file — never modified) only carries `status`/`message`/`body` from the parsed JSON, not response headers, so `Retry-After` is not reachable from a `catch` block. This plan drops the timed disable and just shows the error message, letting the user click again whenever — same information, no fabricated countdown.

## Global Constraints

- No new dependencies — plain Tailwind classes only, consistent with `examples/frontend-pages/*`.
- Every page requiring auth calls `useUser()` from `@/contexts/AuthContext` at the top and returns `null` while it is `null` (the hook redirects itself — no manual `router.push`).
- Client-side API calls go through `api()` / `useApi()` from `@/lib/api` and `@/lib/useApi` — never raw `fetch`.
- Branch on `ApiError.code`, never on `ApiError.message` (CLAUDE.md invariant).
- **No automated tests for this plan.** This codebase has zero `.test.tsx`/`.test.ts` files for anything under `frontend/src/app/**/page.tsx` or client-side `frontend/src/lib/*.ts` (only `frontend/src/lib/server/**` and `frontend/src/app/api/**` are Vitest-covered) — introducing page/component tests here would be a new, unreviewed testing convention, not a bug fix. Each task's verification step is `pnpm typecheck && pnpm lint` (real signal: catches type errors, unused imports, missing `'use client'`, etc.) plus a manual `pnpm dev` smoke check. The final task's manual walkthrough is the only step that can confirm actual feature correctness — say so plainly rather than claiming a full test pass.
- Never modify `frontend/src/lib/api.ts` or `frontend/src/contexts/AuthContext.tsx` (protected files) — only import from them.
- `pnpm format && pnpm lint && pnpm typecheck` must stay green after every task (no `pnpm test` regression expected since nothing here touches `frontend/src/lib/server/**`, but run it once at the end to be sure).

---

### Task 1: `lib/pending-unlock.ts` — payment round-trip helper

**Files:**
- Create: `frontend/src/lib/pending-unlock.ts`

**Interfaces:**
- Consumes: nothing (pure `localStorage` wrapper, no server imports).
- Produces: `PendingUnlock { orderId: string; targetProfileId: string }`, `savePendingUnlock(entry)`, `readPendingUnlock(orderId)`, `clearPendingUnlock()` — Tasks 4 and 5 import all three.

- [ ] **Step 1: Write the file**

Create `frontend/src/lib/pending-unlock.ts`:

```typescript
// Bridges the payment-redirect round-trip: POST /api/orders returns a
// paymentUrl on Bictorys' own hosted-checkout domain, so React state can't
// survive the trip — only `localStorage` can (same pattern `lib/api.ts`
// already uses for the CSRF token). The profile detail page saves the pair
// right before redirecting; the /orders/[id]/success|failed pages read it
// back to link to the profile that was being unlocked.
const STORAGE_KEY = 'app-pending-unlock';

export interface PendingUnlock {
  orderId: string;
  targetProfileId: string;
}

export function savePendingUnlock(entry: PendingUnlock): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Private browsing / storage disabled — the return pages fall back to
    // their generic (no-profile-link) message, so this is a silent no-op.
  }
}

/** Returns the pending entry only if its `orderId` matches — a stale entry
 * from a different, older unlock attempt must never leak into this one. */
export function readPendingUnlock(orderId: string): PendingUnlock | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingUnlock;
    return parsed.orderId === orderId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingUnlock(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors — this file has no dependents yet, so it only needs to compile standalone).

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/pending-unlock.ts
git commit -m "feat(profiles-ui): add pending-unlock localStorage helper"
```

---

### Task 2: `/profile` — Compléter/Mon profil

**Files:**
- Create: `frontend/src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `useUser()` (`@/contexts/AuthContext`), `useToast()` (`@/contexts/ToastContext`), `useApi`/`invalidateCache` (`@/lib/useApi`), `api`/`ApiError` (`@/lib/api`), `GET/PUT /api/profiles/me` (existing, merged).
- Produces: nothing consumed by later tasks — the `/profile` link target used by Task 4's "Modifier mon profil" link.

- [ ] **Step 1: Write the file**

Create `frontend/src/app/profile/page.tsx`:

```typescript
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';

interface Profile {
  id: string;
  bio: string;
  city: string;
  sector: string;
  skills: string[];
  hasIdea: boolean;
  ideaPitch: string | null;
  availableToCofound: boolean;
  externalLink: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
}

const STATUS_LABEL: Record<Profile['status'], string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  SUSPENDED: 'Suspendu',
};

export default function ProfilePage() {
  const user = useUser();
  const { toast } = useToast();
  const { data, loading: profileLoading } = useApi<{ profile: Profile | null }>(
    '/api/profiles/me',
    { skip: !user },
  );

  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [sector, setSector] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [hasIdea, setHasIdea] = useState(false);
  const [ideaPitch, setIdeaPitch] = useState('');
  const [availableToCofound, setAvailableToCofound] = useState(false);
  const [externalLink, setExternalLink] = useState('');
  const [status, setStatus] = useState<Profile['status'] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  // Preload the form from the fetched profile exactly once — after that the
  // form owns its own state (re-running this on every `data` change would
  // stomp on in-progress edits when `invalidateCache` triggers a refetch).
  useEffect(() => {
    if (!data || hydrated) return;
    const p = data.profile;
    if (p) {
      setBio(p.bio);
      setCity(p.city);
      setSector(p.sector);
      setSkills(p.skills);
      setHasIdea(p.hasIdea);
      setIdeaPitch(p.ideaPitch ?? '');
      setAvailableToCofound(p.availableToCofound);
      setExternalLink(p.externalLink ?? '');
      setStatus(p.status);
    }
    setHydrated(true);
  }, [data, hydrated]);

  function addSkillFromInput() {
    const value = skillInput.trim();
    if (value && !skills.includes(value)) {
      setSkills((prev) => [...prev, value]);
    }
    setSkillInput('');
  }

  function removeSkill(skill: string) {
    setSkills((prev) => prev.filter((s) => s !== skill));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    try {
      const res = await api<{ profile: Profile }>('/api/profiles/me', {
        method: 'PUT',
        body: {
          bio,
          city,
          sector,
          skills,
          hasIdea,
          ideaPitch: ideaPitch || undefined,
          availableToCofound,
          externalLink: externalLink || undefined,
        },
      });
      setStatus(res.profile.status);
      invalidateCache('/api/profiles/me');
      toast('Profil enregistré.', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues = (err.body.issues as Array<{ path: (string | number)[]; message: string }> | undefined) ?? [];
        const next: Record<string, string> = {};
        for (const issue of issues) {
          const key = issue.path[0];
          if (typeof key === 'string') next[key] = issue.message;
        }
        setFieldErrors(next);
      } else {
        toast(err instanceof Error ? err.message : 'Erreur inconnue', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  if (profileLoading && !hydrated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
        <p className="text-sm text-gray-600">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mon profil</h1>
        {status && (
          <span className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium">
            {STATUS_LABEL[status]}
          </span>
        )}
      </div>

      {status === 'SUSPENDED' && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Votre profil a été suspendu par un modérateur. Vous pouvez continuer à le modifier, mais
          il ne sera republié qu&apos;après validation.
        </p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Bio
          <textarea
            required
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
          {fieldErrors.bio && <span className="text-xs text-red-600">{fieldErrors.bio}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Ville
          <input
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
          {fieldErrors.city && <span className="text-xs text-red-600">{fieldErrors.city}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Secteur
          <input
            required
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
          {fieldErrors.sector && <span className="text-xs text-red-600">{fieldErrors.sector}</span>}
        </label>

        <div className="flex flex-col gap-1 text-sm">
          Compétences
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => removeSkill(s)}
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs"
                >
                  {s} ×
                </button>
              ))}
            </div>
          )}
          <input
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addSkillFromInput();
              }
            }}
            placeholder="Tape une compétence puis Entrée"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasIdea} onChange={(e) => setHasIdea(e.target.checked)} />
          J&apos;ai une idée
        </label>

        {hasIdea && (
          <label className="flex flex-col gap-1 text-sm">
            Pitch de l&apos;idée
            <textarea
              rows={3}
              value={ideaPitch}
              onChange={(e) => setIdeaPitch(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={availableToCofound}
            onChange={(e) => setAvailableToCofound(e.target.checked)}
          />
          Disponible pour co-fonder
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Lien externe (LinkedIn, portfolio…)
          <input
            value={externalLink}
            onChange={(e) => setExternalLink(e.target.value)}
            placeholder="https://…"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Run: `pnpm dev` (from repo root), then in a browser: log in (or sign up), visit `http://localhost:3000/profile`. Expected: the form renders with a "Brouillon" badge, filling bio/ville/secteur + checking one role checkbox and clicking "Enregistrer" flips the badge to "Publié" and shows a green toast.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/profile
git commit -m "feat(profiles-ui): add /profile edit screen"
```

---

### Task 3: `/directory` — Annuaire

**Files:**
- Create: `frontend/src/app/directory/page.tsx`

**Interfaces:**
- Consumes: `useUser()`, `useApi` (`@/lib/useApi`), `GET /api/profiles` (existing, merged — accepts `sector`, `city`, `skill`, `role` (`'idea' | 'available'`), `cursor` query params, returns `{ items, nextCursor }`).
- Produces: the `/directory/[id]` links each card points to (built in Task 4).

- [ ] **Step 1: Write the file**

Create `frontend/src/app/directory/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/contexts/AuthContext';
import { useApi } from '@/lib/useApi';

interface ProfileCard {
  id: string;
  bio: string;
  city: string;
  sector: string;
  skills: string[];
  hasIdea: boolean;
  availableToCofound: boolean;
}

interface DirectoryPageResult {
  items: ProfileCard[];
  nextCursor: string | null;
}

type RoleFilter = 'idea' | 'available' | null;

interface Filters {
  sector: string;
  city: string;
  skill: string;
  role: RoleFilter;
}

const EMPTY_FILTERS: Filters = { sector: '', city: '', skill: '', role: null };

function buildDirectoryPath(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.sector) params.set('sector', filters.sector);
  if (filters.city) params.set('city', filters.city);
  if (filters.skill) params.set('skill', filters.skill);
  if (filters.role) params.set('role', filters.role);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return `/api/profiles${qs ? `?${qs}` : ''}`;
}

export default function DirectoryPage() {
  const user = useUser();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<ProfileCard[]>([]);

  const path = buildDirectoryPath(filters, cursor);
  const { data, loading } = useApi<DirectoryPageResult>(path, { skip: !user });

  useEffect(() => {
    if (!data) return;
    // `cursor === null` means this response is the first page of the
    // current filter set (replace); otherwise it is a "load more" page
    // fetched via setCursor(nextCursor) below (append).
    setItems((prev) => (cursor === null ? data.items : [...prev, ...data.items]));
  }, [data, cursor]);

  function applyFilters(next: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...next }));
    setCursor(null);
  }

  if (!user) return null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Annuaire</h1>
        <Link href="/profile" className="text-sm underline">
          Mon profil
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setFiltersOpen((v) => !v)}
        className="self-start rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
      >
        {filtersOpen ? 'Masquer les filtres' : 'Filtrer'}
      </button>

      {filtersOpen && (
        <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-4">
          <input
            placeholder="Secteur"
            value={filters.sector}
            onChange={(e) => applyFilters({ sector: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="Ville"
            value={filters.city}
            onChange={(e) => applyFilters({ city: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="Compétence"
            value={filters.skill}
            onChange={(e) => applyFilters({ skill: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => applyFilters({ role: filters.role === 'idea' ? null : 'idea' })}
              className={`flex-1 rounded-md border px-3 py-2 ${
                filters.role === 'idea' ? 'border-black bg-black text-white' : 'border-gray-300'
              }`}
            >
              A une idée
            </button>
            <button
              type="button"
              onClick={() =>
                applyFilters({ role: filters.role === 'available' ? null : 'available' })
              }
              className={`flex-1 rounded-md border px-3 py-2 ${
                filters.role === 'available' ? 'border-black bg-black text-white' : 'border-gray-300'
              }`}
            >
              Dispo pour co-fonder
            </button>
          </div>
        </div>
      )}

      {loading && items.length === 0 && <p className="text-sm text-gray-600">Chargement…</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-gray-600">Aucun profil ne correspond à ces critères.</p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((p) => (
          <li key={p.id}>
            <Link
              href={`/directory/${p.id}`}
              className="block rounded-md border border-gray-200 p-4 hover:bg-gray-50"
            >
              <p className="line-clamp-2 text-sm">{p.bio}</p>
              <p className="mt-1 text-xs text-gray-500">
                {p.city} · {p.sector}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.skills.map((s) => (
                  <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                    {s}
                  </span>
                ))}
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
            </Link>
          </li>
        ))}
      </ul>

      {data?.nextCursor && (
        <button
          type="button"
          onClick={() => setCursor(data.nextCursor)}
          disabled={loading}
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Chargement…' : 'Charger plus'}
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

With `pnpm dev` running and at least one `PUBLISHED` profile (from Task 2's check), visit `http://localhost:3000/directory`. Expected: the profile appears as a card; clicking "Filtrer" reveals the filter panel; typing a non-matching sector shows "Aucun profil ne correspond à ces critères."

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/directory/page.tsx
git commit -m "feat(profiles-ui): add /directory listing with collapsible filters"
```

---

### Task 4: `/directory/[id]` — Détail profil + déblocage

**Files:**
- Create: `frontend/src/app/directory/[id]/page.tsx`

**Interfaces:**
- Consumes: `useUser()`, `useToast()`, `useApi` (`@/lib/useApi`), `api`/`ApiError` (`@/lib/api`), `savePendingUnlock` (Task 1), `GET /api/profiles/[id]` and `POST /api/orders` (existing, merged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the file**

Create `frontend/src/app/directory/[id]/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { savePendingUnlock } from '@/lib/pending-unlock';

interface ProfileDetail {
  id: string;
  bio: string;
  city: string;
  sector: string;
  skills: string[];
  hasIdea: boolean;
  ideaPitch: string | null;
  availableToCofound: boolean;
  externalLink: string | null;
  status: string;
  isOwner: boolean;
  isUnlocked: boolean;
  contactEmail: string | null;
  unlockPriceFcfa: number;
}

interface OrderResponse {
  id: string;
  paymentUrl: string;
  status: string;
}

export default function ProfileDetailPage() {
  const user = useUser();
  const { toast } = useToast();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data, loading, error } = useApi<{ profile: ProfileDetail }>(`/api/profiles/${id}`, {
    skip: !user,
  });

  const [unlocking, setUnlocking] = useState(false);

  async function onUnlock() {
    if (!data) return;
    setUnlocking(true);
    try {
      const res = await api<OrderResponse>('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          amount: data.profile.unlockPriceFcfa,
          currency: 'XOF',
          metadata: { type: 'PROFILE_UNLOCK', targetProfileId: id },
        },
      });
      savePendingUnlock({ orderId: res.id, targetProfileId: id });
      window.location.href = res.paymentUrl;
      // No `finally` here: on success the browser is navigating away, so
      // leaving the button in its "Redirection…" state until then is correct.
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'PAYMENT_PROVIDER_UNCONFIGURED':
          case 'PAYMENT_PROVIDER_UNAVAILABLE':
            toast('Paiement momentanément indisponible, réessaie dans un instant.', 'error');
            break;
          case 'PAYMENT_FAILED':
            toast('Le paiement a échoué, réessaie.', 'error');
            break;
          default:
            toast(err.message, 'error');
        }
      } else {
        toast('Erreur réseau, réessaie.', 'error');
      }
      setUnlocking(false);
    }
  }

  if (!user) return null;

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
        <p className="text-sm text-gray-600">Chargement…</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm text-gray-600">Profil introuvable.</p>
        <Link href="/directory" className="text-sm underline">
          Retour à l&apos;annuaire
        </Link>
      </main>
    );
  }

  const p = data.profile;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-10">
      <Link href="/directory" className="text-sm underline">
        ← Annuaire
      </Link>

      <h1 className="text-2xl font-bold">{p.sector}</h1>
      <p className="text-sm text-gray-500">{p.city}</p>
      <p className="text-sm">{p.bio}</p>

      {p.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.skills.map((s) => (
            <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
              {s}
            </span>
          ))}
        </div>
      )}

      {p.hasIdea && p.ideaPitch && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
          <p className="font-medium">Idée</p>
          <p>{p.ideaPitch}</p>
        </div>
      )}

      {p.availableToCofound && <p className="text-sm text-green-700">Disponible pour co-fonder</p>}

      {p.externalLink && (
        <a href={p.externalLink} target="_blank" rel="noreferrer" className="text-sm underline">
          Lien externe
        </a>
      )}

      <div className="mt-4 rounded-md border border-gray-200 p-4">
        {p.isOwner ? (
          <>
            <p className="text-sm text-gray-500">C&apos;est votre profil.</p>
            <Link href="/profile" className="mt-2 inline-block text-sm underline">
              Modifier mon profil
            </Link>
          </>
        ) : p.isUnlocked ? (
          <>
            <p className="text-sm text-gray-500">Coordonnées</p>
            <p className="font-medium">{p.contactEmail}</p>
          </>
        ) : (
          <button
            type="button"
            onClick={onUnlock}
            disabled={unlocking}
            className="w-full rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {unlocking ? 'Redirection…' : `Débloquer les coordonnées (${p.unlockPriceFcfa} FCFA)`}
          </button>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

From `/directory`, click into a profile card as its owner: expect "C'est votre profil." + a "Modifier mon profil" link, no unlock button. Log in as a second account and open the same profile: expect the "Débloquer les coordonnées (500 FCFA)" button.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/directory/[id]"
git commit -m "feat(profiles-ui): add profile detail screen with pay-per-unlock"
```

---

### Task 5: `/orders/[id]/success` and `/orders/[id]/failed` — payment return pages

**Files:**
- Create: `frontend/src/app/orders/[id]/success/page.tsx`
- Create: `frontend/src/app/orders/[id]/failed/page.tsx`

**Interfaces:**
- Consumes: `readPendingUnlock`, `clearPendingUnlock` (Task 1).
- Produces: nothing consumed elsewhere — these are the terminal landing pages `POST /api/orders`' hardcoded `successUrl`/`failureUrl` (`${PUBLIC_URL}/orders/${order.id}/success|failed`) redirect to, for **any** order type, not just profile unlocks.

- [ ] **Step 1: Write the success page**

Create `frontend/src/app/orders/[id]/success/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { readPendingUnlock, clearPendingUnlock } from '@/lib/pending-unlock';

export default function OrderSuccessPage() {
  const params = useParams<{ id: string }>();
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);

  useEffect(() => {
    const pending = readPendingUnlock(params.id);
    if (pending) {
      setTargetProfileId(pending.targetProfileId);
      clearPendingUnlock();
    }
  }, [params.id]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">Paiement reçu</h1>
      {targetProfileId ? (
        <>
          <p className="text-sm text-gray-600">
            Merci — la confirmation peut prendre quelques secondes avant que les coordonnées ne
            s&apos;affichent.
          </p>
          <Link
            href={`/directory/${targetProfileId}`}
            className="mt-4 inline-block rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Voir le profil débloqué
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600">Votre paiement a bien été confirmé.</p>
          <Link href="/directory" className="mt-4 inline-block text-sm underline">
            Retour à l&apos;annuaire
          </Link>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write the failure page**

Create `frontend/src/app/orders/[id]/failed/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { readPendingUnlock, clearPendingUnlock } from '@/lib/pending-unlock';

export default function OrderFailedPage() {
  const params = useParams<{ id: string }>();
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);

  useEffect(() => {
    const pending = readPendingUnlock(params.id);
    if (pending) {
      setTargetProfileId(pending.targetProfileId);
      clearPendingUnlock();
    }
  }, [params.id]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">Paiement non abouti</h1>
      <p className="text-sm text-gray-600">
        Le paiement n&apos;a pas pu être confirmé. Tu peux réessayer.
      </p>
      <Link
        href={targetProfileId ? `/directory/${targetProfileId}` : '/directory'}
        className="mt-4 inline-block rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50"
      >
        {targetProfileId ? 'Réessayer le déblocage' : "Retour à l'annuaire"}
      </Link>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Manual smoke check**

Visit `http://localhost:3000/orders/anything/success` and `http://localhost:3000/orders/anything/failed` directly (no matching `localStorage` entry). Expected: both render the generic (no-profile-link) message + a link back to `/directory`, with no console error.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/orders
git commit -m "feat(profiles-ui): add payment return pages for the unlock flow"
```

---

### Task 6: Full manual walkthrough + final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verification sweep**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. `pnpm test` is not expected to change (no `frontend/src/lib/server/**` or `frontend/src/app/api/**` file was touched by this plan) — this is a regression check, not new coverage for the UI itself (see Global Constraints on why there is none).

- [ ] **Step 2: Manual end-to-end walkthrough (cannot be automated — do this in a real browser)**

With `pnpm dev` running and Bictorys test credentials configured (`BICTORYS_*` env vars) or accepting that the unlock button will show `PAYMENT_PROVIDER_UNCONFIGURED` if not:

1. Sign up / log in as account A. Go to `/profile`, fill bio/ville/secteur, check "Disponible pour co-fonder", save. Confirm the badge shows "Publié".
2. Log in as account B (different browser/incognito). Go to `/directory`, confirm A's profile appears; use the filter panel to filter by A's ville/secteur and confirm it still appears; filter by a non-matching value and confirm the empty-state message.
3. Open A's profile detail as B. Confirm coordinates are hidden and the "Débloquer…" button shows the exact price from `unlockPriceFcfa`.
4. If Bictorys test credentials are configured: click "Débloquer", complete the test payment, confirm landing on `/orders/[id]/success` with a "Voir le profil débloqué" link, and that A's `contactEmail` appears after following it (allow a few seconds for the webhook).
5. As account A, confirm `/directory/[A's id]` (viewed as A) shows "C'est votre profil." and never shows the unlock button, regardless of A's own `ProfileUnlock` state.

Report the outcome honestly — if step 4 cannot be exercised (no Bictorys test credentials available in this environment), say so explicitly instead of claiming the full flow was verified; steps 1–3 and 5 remain fully verifiable without a live payment provider.

---

## Self-Review Notes

- **Spec coverage:** all 4 screens + the 2 payment-return pages from the approved UI spec are covered (Tasks 2–5); the pending-unlock bridge is its own task since both Task 4 and Task 5 depend on it. Admin moderation UI stays out of scope per the spec.
- **Placeholder scan:** no TBD/TODO; every step has full, runnable component code and an exact command.
- **Type consistency:** `ProfileDetail`, `ProfileCard`, and `Profile` field names match `frontend/src/app/api/profiles/{me,[id],route}.ts`'s actual response shapes exactly (verified against the merged source, not the earlier draft plan). `PendingUnlock` is defined once in Task 1 and only ever imported in Tasks 4–5.
- **Deviation from the writing-plans TDD template, explained:** no task has a "write failing test" step. This repository's own convention (verified: zero `.test.tsx` files anywhere under `frontend/src/app/**/page.tsx`, zero tests for client `frontend/src/lib/*.ts`) draws the line at the API boundary — everything server-side is Vitest-covered, everything client-side is verified by running the app. Matching that line is "follow existing patterns," not skipping rigor; the plan is explicit about it instead of quietly omitting tests.
