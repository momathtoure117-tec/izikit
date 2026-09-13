'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { readPendingUnlock } from '@/lib/pending-unlock';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function OrderSuccessPage() {
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
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Paiement reçu</h1>
          {targetProfileId ? (
            <>
              <p className="text-sm text-slate-600">
                Merci — la confirmation peut prendre quelques secondes avant que les coordonnées ne
                s&apos;affichent.
              </p>
              <Link
                href={`/directory/${targetProfileId}`}
                className={buttonVariants({ className: 'mt-2 w-full' })}
              >
                Voir le profil débloqué
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">Ton paiement a bien été confirmé.</p>
              <Link
                href="/directory"
                className={buttonVariants({ variant: 'ghost', className: 'mt-2' })}
              >
                Retour à l&apos;annuaire
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
