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
