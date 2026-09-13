'use client';

import Link from 'next/link';
import { Handshake, Lightbulb, Users } from 'lucide-react';
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
              <>
                <Link
                  href="/directory"
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  Annuaire
                </Link>
                <Link href="/profile" className={buttonVariants({ size: 'sm' })}>
                  Mon profil
                </Link>
              </>
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
          Trouvez votre co-fondateur en Afrique
        </h1>
        <p className="mt-4 max-w-xl text-lg text-slate-600">
          CoFound Africa met en relation des porteurs de projets et des profils prêts à co-fonder.
          Créez votre profil, parcourez l&rsquo;annuaire et entrez en contact.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/directory" className={buttonVariants({ size: 'lg' })}>
            Parcourir l&rsquo;annuaire
          </Link>
          {!loading && !user && (
            <Link href="/signup" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Créer mon profil
            </Link>
          )}
        </div>

        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <Users className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Annuaire filtrable</p>
              <p className="text-sm text-slate-600">
                Filtrez par secteur, ville ou compétence pour trouver le bon profil.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <Lightbulb className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Partagez votre idée</p>
              <p className="text-sm text-slate-600">
                Décrivez votre projet ou signalez votre disponibilité à co-fonder.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <Handshake className="h-6 w-6 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">Mise en relation</p>
              <p className="text-sm text-slate-600">
                Débloquez les coordonnées d&rsquo;un profil pour échanger directement.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
