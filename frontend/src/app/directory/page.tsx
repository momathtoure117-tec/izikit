'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [draftSector, setDraftSector] = useState('');
  const [draftCity, setDraftCity] = useState('');
  const [draftSkill, setDraftSkill] = useState('');

  const path = buildDirectoryPath(filters, cursor);
  const { data, loading, error, refresh } = useApi<DirectoryPageResult>(path, { skip: !user });
  // `loading`'s initial value is computed once at mount from the FIRST
  // `skip`; when `useUser()` resolves, the render where `skip` flips still
  // shows the OLD `loading`/`data`/`error` because `useApi`'s fetch effect
  // hasn't run yet. `pending` recomputes "nothing to show yet" every render
  // instead of trusting that transitional state.
  const pending = loading || (!data && !error);

  // `useApi`'s `data` lags one render/effect-cycle behind a `path` change
  // (its `useState` initializer only runs once at mount; `setData` only
  // fires from inside its own fetch effect). Keying replace-vs-append off
  // `cursor` in this effect's deps would fire on the stale `data` from the
  // PREVIOUS cursor before the real new page arrives — appending it twice.
  // Instead: key the effect on `[data]` alone (fires only when `useApi`'s
  // data reference genuinely changes) and decide replace/append via a ref
  // set at the moment the fetch is TRIGGERED, not when it resolves.
  const appendModeRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    setItems((prev) => (appendModeRef.current ? [...prev, ...data.items] : data.items));
    appendModeRef.current = false;
  }, [data]);

  function applyFilters(next: Partial<Filters>) {
    appendModeRef.current = false;
    setFilters((prev) => ({ ...prev, ...next }));
    setCursor(null);
  }

  function loadMore() {
    if (!data?.nextCursor) return;
    appendModeRef.current = true;
    setCursor(data.nextCursor);
  }

  // Debounce the three free-text filters — without this, every keystroke
  // fires an authenticated request against the directory endpoint.
  useEffect(() => {
    const t = setTimeout(() => {
      applyFilters({ sector: draftSector, city: draftCity, skill: draftSkill });
    }, 300);
    return () => clearTimeout(t);
  }, [draftSector, draftCity, draftSkill]);

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
            aria-label="Secteur"
            value={draftSector}
            onChange={(e) => setDraftSector(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="Ville"
            aria-label="Ville"
            value={draftCity}
            onChange={(e) => setDraftCity(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="Compétence"
            aria-label="Compétence"
            value={draftSkill}
            onChange={(e) => setDraftSkill(e.target.value)}
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
                filters.role === 'available'
                  ? 'border-black bg-black text-white'
                  : 'border-gray-300'
              }`}
            >
              Dispo pour co-fonder
            </button>
          </div>
        </div>
      )}

      {pending && items.length === 0 && <p className="text-sm text-gray-600">Chargement…</p>}

      {!pending && error && items.length === 0 && (
        <div className="flex flex-col gap-2 text-sm text-red-600">
          <p>Impossible de charger l&apos;annuaire pour le moment.</p>
          <button type="button" onClick={() => void refresh()} className="self-start underline">
            Réessayer
          </button>
        </div>
      )}

      {!pending && !error && items.length === 0 && (
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
          onClick={loadMore}
          disabled={loading}
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Chargement…' : 'Charger plus'}
        </button>
      )}
    </main>
  );
}
