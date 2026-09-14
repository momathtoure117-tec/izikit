'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, MailCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_RESET_REQUESTS') {
        setError('Trop de demandes de réinitialisation pour cet email. Réessaie dans une heure.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
              <MailCheck className="h-6 w-6 text-indigo-600" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Vérifie ta boîte mail
            </h1>
            <p className="text-sm text-slate-600">
              Si un compte existe pour <strong>{email}</strong>, tu recevras un code de
              réinitialisation dans la minute qui suit.
            </p>
            <Link
              href="/reset-password"
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              Tu as déjà ton code ?
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Mot de passe oublié ?</CardTitle>
          <CardDescription>
            Entre ton email, on t&rsquo;enverra un code pour réinitialiser ton mot de passe.
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
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Envoi…' : 'Envoyer le code'}
            </Button>
          </form>
          <p className="text-center text-sm text-slate-600">
            Tu t&rsquo;en souviens ?{' '}
            <Link href="/login" className="font-medium text-indigo-600 hover:underline">
              Se connecter
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
