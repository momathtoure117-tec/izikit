'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SlidersHorizontal, Lightbulb, Handshake } from 'lucide-react';
import { useUser } from '@/contexts/AuthContext';
import { useApi } from '@/lib/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 bg-slate-50 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Annuaire</h1>
          <p className="text-sm text-slate-500">Découvre les fondateurs de la communauté.</p>
        </div>
        <Link href="/profile" className="text-sm font-medium text-indigo-600 hover:underline">
          Mon profil
        </Link>
      </div>

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => setFiltersOpen((v) => !v)}
      >
        <SlidersHorizontal className="h-4 w-4" />
        {filtersOpen ? 'Masquer les filtres' : 'Filtrer'}
      </Button>

      {filtersOpen && (
        <Card className="flex flex-col gap-3 p-4">
          <Input
            placeholder="Secteur"
            aria-label="Secteur"
            value={draftSector}
            onChange={(e) => setDraftSector(e.target.value)}
          />
          <Input
            placeholder="Ville"
            aria-label="Ville"
            value={draftCity}
            onChange={(e) => setDraftCity(e.target.value)}
          />
          <Input
            placeholder="Compétence"
            aria-label="Compétence"
            value={draftSkill}
            onChange={(e) => setDraftSkill(e.target.value)}
          />
          <div className="flex gap-2 text-sm">
            <Button
              type="button"
              variant={filters.role === 'idea' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => applyFilters({ role: filters.role === 'idea' ? null : 'idea' })}
            >
              <Lightbulb className="h-4 w-4" />A une idée
            </Button>
            <Button
              type="button"
              variant={filters.role === 'available' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() =>
                applyFilters({ role: filters.role === 'available' ? null : 'available' })
              }
            >
              <Handshake className="h-4 w-4" />
              Dispo pour co-fonder
            </Button>
          </div>
        </Card>
      )}

      {pending && items.length === 0 && <p className="text-sm text-slate-500">Chargement…</p>}

      {!pending && error && items.length === 0 && (
        <div className="flex flex-col gap-2 text-sm text-red-600">
          <p>Impossible de charger l&apos;annuaire pour le moment.</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="cursor-pointer self-start underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {!pending && !error && items.length === 0 && (
        <p className="text-sm text-slate-500">Aucun profil ne correspond à ces critères.</p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((p) => (
          <li key={p.id}>
            <Link href={`/directory/${p.id}`}>
              <Card className="p-4 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40">
                <p className="line-clamp-2 text-sm text-slate-700">{p.bio}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {p.city} · {p.sector}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.skills.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                  {p.hasIdea && <Badge>A une idée</Badge>}
                  {p.availableToCofound && <Badge variant="success">Dispo pour co-fonder</Badge>}
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      {data?.nextCursor && (
        <Button type="button" variant="outline" onClick={loadMore} disabled={loading}>
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </main>
  );
}
