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
