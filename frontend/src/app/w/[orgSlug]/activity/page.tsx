'use client';

import { Activity as ActivityIcon } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ActivityEntry {
  id: string;
  type: string;
  actorName: string;
  description: string;
  createdAt: string;
}

export default function ActivityPage() {
  const { organizationId, loading: wsLoading, notFound } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/activity` : '';
  const { data, loading, error } = useApi<{ activity: ActivityEntry[] }>(path, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger l&apos;activité récente.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <ActivityIcon className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Activité récente</h1>
      </header>

      {data.activity.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune activité pour l&apos;instant.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.activity.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <span className="font-medium text-slate-900">{entry.actorName}</span>{' '}
              {entry.description}
              <span className="ml-2 text-xs text-slate-400">
                {new Date(entry.createdAt).toLocaleString('fr-FR')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
