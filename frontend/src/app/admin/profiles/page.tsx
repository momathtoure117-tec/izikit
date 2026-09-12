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
