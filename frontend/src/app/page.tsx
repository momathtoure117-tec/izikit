'use client';

import Link from 'next/link';
import { FolderKanban, ListChecks, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            CoFound Africa
          </span>
          <nav className="flex items-center gap-3">
            {!loading && user ? (
              <Link href="/onboarding" className={buttonVariants({ size: 'sm' })}>
                Ouvrir mon espace de travail
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Se connecter
                </Link>
                <Link href="/signup" className={buttonVariants({ size: 'sm' })}>
                  Créer un compte
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="mx-auto flex max-w-3xl flex-1 flex-col items-center px-4 py-20 text-center sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          Gérez vos projets d&rsquo;équipe, simplement
        </h1>
        <p className="mt-4 max-w-xl text-lg text-slate-600">
          CoFound Africa est l&rsquo;espace de travail de votre équipe : projets, tâches et
          échéances au même endroit.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {!loading && user ? (
            <Link href="/onboarding" className={buttonVariants({ size: 'lg' })}>
              Ouvrir mon espace de travail
            </Link>
          ) : (
            <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
              Commencer gratuitement
            </Link>
          )}
        </div>

        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <FolderKanban className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Projets</p>
              <p className="text-sm text-slate-600">
                Organisez le travail de votre équipe par projet.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <ListChecks className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Tâches</p>
              <p className="text-sm text-slate-600">
                Assignez, suivez et terminez vos tâches sans effort.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <Users className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Équipe</p>
              <p className="text-sm text-slate-600">
                Invitez vos collègues et travaillez ensemble.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
