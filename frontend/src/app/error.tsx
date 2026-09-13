'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Une erreur est survenue
          </h1>
          <p className="text-sm text-slate-600">{error.message}</p>
          <Button type="button" onClick={reset} className="mt-2 w-full">
            Réessayer
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
