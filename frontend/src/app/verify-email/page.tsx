'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MailCheck, AlertCircle } from 'lucide-react';
import { api, ApiError, storeCsrfToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If both query params are present (user clicked the link), submit
  // automatically — the form is just a fallback for manual entry.
  useEffect(() => {
    const qEmail = params.get('email');
    const qCode = params.get('code');
    if (qEmail && qCode) {
      void verify(qEmail, qCode);
    }
  }, []);

  async function verify(emailValue: string, codeValue: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ csrfToken?: string }>('/api/auth/verify-email', {
        method: 'POST',
        body: { email: emailValue, code: codeValue },
      });
      if (res.csrfToken) storeCsrfToken(res.csrfToken);
      await refresh();
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void verify(email, code);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <MailCheck className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">Vérifie ton email</CardTitle>
          <CardDescription>
            Nous t&rsquo;avons envoyé un code à 8 caractères. Il expire dans 10 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Code de vérification</Label>
              <Input
                id="code"
                type="text"
                required
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={8}
                className="font-mono tracking-widest uppercase"
              />
            </div>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Vérification…' : 'Vérifier'}
            </Button>
          </form>
          <p className="text-center text-sm text-slate-600">
            Tu n&rsquo;as pas reçu le code ?{' '}
            <Link href="/signup" className="font-medium text-indigo-600 hover:underline">
              Réessaie l&rsquo;inscription
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

// Wrap in <Suspense> because useSearchParams() requires it under the App Router.
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
