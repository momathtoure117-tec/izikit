'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Building2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Organization {
  id: string;
  slug: string;
  name: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ organizations: Organization[] }>('/api/organizations')
      .then((res) => {
        if (cancelled) return;
        const first = res.organizations[0];
        if (first) {
          router.replace(`/w/${first.slug}/dashboard`);
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ organization: Organization }>('/api/organizations', {
        method: 'POST',
        body: { name },
      });
      router.push(`/w/${res.organization.slug}/dashboard`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-600">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Building2 className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">Crée ton espace de travail</CardTitle>
          <CardDescription>
            Un espace de travail regroupe tes projets, tes tâches et ton équipe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Nom de l&apos;espace de travail</Label>
              <Input
                id="name"
                required
                autoFocus
                placeholder="Mon entreprise"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Création…' : "Créer l'espace de travail"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
