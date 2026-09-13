'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';

type StatusFilter = 'PUBLISHED' | 'SUSPENDED' | 'DRAFT';

const STATUS_LABEL: Record<StatusFilter, string> = {
  PUBLISHED: 'Publié',
  SUSPENDED: 'Suspendu',
  DRAFT: 'Brouillon',
};

const STATUS_BADGE_VARIANT: Record<StatusFilter, 'success' | 'destructive' | 'secondary'> = {
  PUBLISHED: 'success',
  SUSPENDED: 'destructive',
  DRAFT: 'secondary',
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
    if (reset) {
      setProfiles([]);
      setCursor(null);
      setHasMore(false);
    }
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

  async function applyStatusChange(id: string, status: 'PUBLISHED' | 'SUSPENDED', reason?: string) {
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
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Vérification de l&apos;accès…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 bg-slate-50 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Modération des profils</h1>
        <p className="text-sm text-slate-500">Suspends ou republie les profils fondateurs.</p>
      </div>

      <div className="flex gap-2 text-sm">
        {(['PUBLISHED', 'SUSPENDED', 'DRAFT'] as const).map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            onClick={() => setStatusFilter(s)}
          >
            {STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>Impossible de charger la liste des profils.</p>
          <button
            type="button"
            onClick={() => void load(true)}
            className="cursor-pointer self-start underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {!error && !loading && profiles.length === 0 && (
        <p className="text-sm text-slate-500">Aucun profil ne correspond à ce filtre.</p>
      )}

      {profiles.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Bio</th>
                <th className="px-4 py-3">Ville</th>
                <th className="px-4 py-3">Secteur</th>
                <th className="px-4 py-3">Compétences</th>
                <th className="px-4 py-3">Rôle</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Créé le</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">{p.user.email}</td>
                  <td className="max-w-xs px-4 py-3 text-slate-600">
                    <span className="line-clamp-2">{p.bio}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.city}</td>
                  <td className="px-4 py-3 text-slate-600">{p.sector}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.skills.map((s) => (
                        <Badge key={s} variant="secondary">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {p.hasIdea && <Badge>A une idée</Badge>}
                      {p.availableToCofound && (
                        <Badge variant="success">Dispo pour co-fonder</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE_VARIANT[p.status]}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                  <td className="min-w-[220px] px-4 py-3">
                    {p.status === 'PUBLISHED' &&
                      (expandedReasonId === p.id ? (
                        <div className="flex flex-col gap-1.5">
                          <Textarea
                            rows={2}
                            value={reasonDraft[p.id] ?? ''}
                            onChange={(e) =>
                              setReasonDraft((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            placeholder="Raison de la suspension"
                            aria-label="Raison de la suspension"
                            aria-invalid={!!actionError[p.id]}
                            aria-describedby={
                              actionError[p.id] ? `reason-error-${p.id}` : undefined
                            }
                            className="text-xs"
                          />
                          {actionError[p.id] && (
                            <span id={`reason-error-${p.id}`} className="text-xs text-red-600">
                              {actionError[p.id]}
                            </span>
                          )}
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => confirmSuspend(p.id)}
                              disabled={submitting[p.id]}
                            >
                              {submitting[p.id] ? 'Envoi…' : 'Confirmer'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => cancelSuspend(p.id)}
                              disabled={submitting[p.id]}
                            >
                              Annuler
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startSuspend(p.id)}
                        >
                          Suspendre
                        </Button>
                      ))}
                    {p.status === 'SUSPENDED' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => republish(p.id)}
                        disabled={submitting[p.id]}
                      >
                        {submitting[p.id] ? 'Envoi…' : 'Republier'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {hasMore && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => void load(false)}
          disabled={loading}
        >
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </main>
  );
}
