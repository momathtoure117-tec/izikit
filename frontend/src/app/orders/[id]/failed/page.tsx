'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { readPendingUnlock } from '@/lib/pending-unlock';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <XCircle className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Paiement non abouti</h1>
          <p className="text-sm text-slate-600">
            Le paiement n&apos;a pas pu être confirmé. Tu peux réessayer.
          </p>
          <Link
            href={targetProfileId ? `/directory/${targetProfileId}` : '/directory'}
            className={buttonVariants({ variant: 'outline', className: 'mt-2 w-full' })}
          >
            {targetProfileId ? 'Réessayer le déblocage' : "Retour à l'annuaire"}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
