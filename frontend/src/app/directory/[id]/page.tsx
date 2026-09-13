'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, Lightbulb, Handshake, Lock, Mail } from 'lucide-react';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { savePendingUnlock } from '@/lib/pending-unlock';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

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
            toast('Une erreur est survenue, réessaie.', 'error');
        }
      } else {
        toast('Erreur réseau, réessaie.', 'error');
      }
      setUnlocking(false);
    }
  }

  if (!user) return null;

  // `loading`'s initial value is computed once at mount from the FIRST
  // `skip`; when `useUser()` resolves, the render where `skip` flips still
  // shows the OLD `loading`/`data`/`error` because `useApi`'s fetch effect
  // hasn't run yet. `pending` recomputes "nothing to show yet" every render
  // instead of trusting that transitional state.
  const pending = loading || (!data && !error);

  if (pending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-500">Chargement…</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
        <p className="text-sm text-slate-500">Profil introuvable.</p>
        <Link href="/directory" className="text-sm font-medium text-indigo-600 hover:underline">
          Retour à l&apos;annuaire
        </Link>
      </main>
    );
  }

  const p = data.profile;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 bg-slate-50 px-4 py-10">
      <Link
        href="/directory"
        className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Annuaire
      </Link>

      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{p.sector}</h1>
        <p className="text-sm text-slate-500">{p.city}</p>
        <p className="mt-4 text-sm text-slate-700">{p.bio}</p>

        {p.skills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1">
            {p.skills.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        )}

        {p.hasIdea && p.ideaPitch && (
          <div className="mt-4 flex gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm">
            <Lightbulb className="h-4 w-4 shrink-0 text-indigo-600" />
            <div>
              <p className="font-medium text-indigo-900">Idée</p>
              <p className="text-indigo-800">{p.ideaPitch}</p>
            </div>
          </div>
        )}

        {p.availableToCofound && (
          <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
            <Handshake className="h-4 w-4" />
            Disponible pour co-fonder
          </div>
        )}

        {p.externalLink && (
          <a
            href={p.externalLink}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Lien externe
          </a>
        )}
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          {p.isOwner ? (
            <>
              <p className="text-sm text-slate-500">C&apos;est votre profil.</p>
              {p.contactEmail && (
                <p className="flex items-center gap-2 font-medium text-slate-900">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {p.contactEmail}
                </p>
              )}
              <Link href="/profile" className="text-sm font-medium text-indigo-600 hover:underline">
                Modifier mon profil
              </Link>
            </>
          ) : p.isUnlocked ? (
            <>
              <p className="text-sm text-slate-500">Coordonnées</p>
              <p className="flex items-center gap-2 font-medium text-slate-900">
                <Mail className="h-4 w-4 text-slate-400" />
                {p.contactEmail}
              </p>
            </>
          ) : (
            <Button type="button" onClick={onUnlock} disabled={unlocking} className="w-full">
              <Lock className="h-4 w-4" />
              {unlocking ? 'Redirection…' : `Débloquer les coordonnées (${p.unlockPriceFcfa} FCFA)`}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
