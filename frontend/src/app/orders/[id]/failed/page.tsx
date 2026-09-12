'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { readPendingUnlock } from '@/lib/pending-unlock';

export default function OrderFailedPage() {
  const params = useParams<{ id: string }>();
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);

  useEffect(() => {
    const pending = readPendingUnlock(params.id);
    if (pending) {
      setTargetProfileId(pending.targetProfileId);
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
