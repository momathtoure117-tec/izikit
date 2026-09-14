'use client';

import { ListChecks, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { WorkspaceNotFound } from '@/components/workspace-not-found';

interface MyTask {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  dueAt: string | null;
  project: { id: string; name: string };
}

const STATUS_LABEL: Record<MyTask['status'], string> = {
  TODO: 'À faire',
  IN_PROGRESS: 'En cours',
  DONE: 'Terminé',
};

const STATUS_BADGE_VARIANT: Record<MyTask['status'], 'secondary' | 'default' | 'success'> = {
  TODO: 'secondary',
  IN_PROGRESS: 'default',
  DONE: 'success',
};

const NEXT_STATUS: Record<MyTask['status'], MyTask['status']> = {
  TODO: 'IN_PROGRESS',
  IN_PROGRESS: 'DONE',
  DONE: 'TODO',
};

export default function MyTasksPage() {
  const { organizationId, loading: wsLoading, notFound: wsNotFound } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/tasks?assignee=me` : '';
  const { data, loading, error, refresh } = useApi<{ tasks: MyTask[] }>(path, {
    skip: !organizationId,
  });
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function onCycleStatus(task: MyTask) {
    if (!organizationId) return;
    setMutationError(null);
    try {
      await api(`/api/organizations/${organizationId}/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: NEXT_STATUS[task.status] },
      });
      await refresh();
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    }
  }

  if (wsNotFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <AlertDescription>Impossible de charger tes tâches.</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => window.location.reload()}
        >
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="p-8 text-sm text-slate-600">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
        <ListChecks className="h-5 w-5 text-indigo-600" />
        Mes tâches
      </h1>

      <div className="mt-4 flex flex-col gap-2">
        {(data?.tasks.length ?? 0) === 0 && (
          <p className="text-sm text-slate-500">Aucune tâche ne t&rsquo;est assignée.</p>
        )}
        {data?.tasks.map((task) => (
          <Card key={task.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">{task.title}</p>
                <p className="text-xs text-slate-500">
                  {task.project.name}
                  {task.dueAt && ` · ${new Date(task.dueAt).toLocaleDateString('fr-FR')}`}
                </p>
              </div>
              <button type="button" onClick={() => onCycleStatus(task)} className="cursor-pointer">
                <Badge variant={STATUS_BADGE_VARIANT[task.status]}>
                  {STATUS_LABEL[task.status]}
                </Badge>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
      {mutationError && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
