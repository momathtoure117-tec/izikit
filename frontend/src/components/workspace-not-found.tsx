'use client';

import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Rendered by every workspace content page when the URL's `orgSlug` matches none of the caller's
 * workspaces (`useWorkspace().notFound`).
 *
 * Without it the pages misbehave in two different ways: `WorkspaceContext` leaves
 * `organizationId` null, so each page's `useApi(...)` call is skipped — no fetch, no error — and
 * the page either spins on "Chargement…" forever or falls through to an empty state that reads as
 * "this workspace exists and is empty". The wording mirrors the sidebar's own `notFound` branch in
 * `w/[orgSlug]/layout.tsx` so the two agree.
 */
export function WorkspaceNotFound() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <AlertDescription>Espace de travail introuvable.</AlertDescription>
      </Alert>
      <Link
        href="/onboarding"
        className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
      >
        Revenir à mes espaces de travail
      </Link>
    </div>
  );
}
