'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Task {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assigneeId: string | null;
  dueAt: string | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  tasks: Task[];
}

const STATUS_LABEL: Record<Task['status'], string> = {
  TODO: 'À faire',
  IN_PROGRESS: 'En cours',
  DONE: 'Terminé',
};

const STATUS_BADGE_VARIANT: Record<Task['status'], 'secondary' | 'default' | 'success'> = {
  TODO: 'secondary',
  IN_PROGRESS: 'default',
  DONE: 'success',
};

const NEXT_STATUS: Record<Task['status'], Task['status']> = {
  TODO: 'IN_PROGRESS',
  IN_PROGRESS: 'DONE',
  DONE: 'TODO',
};

export default function ProjectDetailPage() {
  const { organizationId, slug, loading: wsLoading } = useWorkspace();
  const params = useParams<{ projectId: string }>();
  const path = organizationId
    ? `/api/organizations/${organizationId}/projects/${params.projectId}`
    : '';
  const { data, loading, error, refresh } = useApi<{ project: ProjectDetail }>(path, {
    skip: !organizationId,
  });

  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setCreating(true);
    setFormError(null);
    try {
      await api(`${path}/tasks`, { method: 'POST', body: { title } });
      setTitle('');
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setCreating(false);
    }
  }

  async function onCycleStatus(task: Task) {
    if (!organizationId) return;
    try {
      await api(`/api/organizations/${organizationId}/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: NEXT_STATUS[task.status] },
      });
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <AlertDescription>Impossible de charger le projet.</AlertDescription>
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

  const { project } = data;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href={`/w/${slug}/projects`}
        className="flex items-center gap-1.5 text-sm text-slate-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Projets
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{project.name}</h1>
      {project.description && <p className="mt-1 text-sm text-slate-600">{project.description}</p>}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Nouvelle tâche</CardTitle>
          <CardDescription>Ajoute une tâche à ce projet.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreateTask} className="flex gap-2">
            <Input
              placeholder="Titre de la tâche"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <Button type="submit" disabled={creating}>
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          </form>
          {formError && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-2">
        {project.tasks.length === 0 && (
          <p className="text-sm text-slate-500">Aucune tâche pour l&rsquo;instant.</p>
        )}
        {project.tasks.map((task) => (
          <Card key={task.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <span className="text-sm font-medium text-slate-900">{task.title}</span>
              <button type="button" onClick={() => onCycleStatus(task)} className="cursor-pointer">
                <Badge variant={STATUS_BADGE_VARIANT[task.status]}>
                  {STATUS_LABEL[task.status]}
                </Badge>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
