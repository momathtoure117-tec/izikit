'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plus, FolderKanban, AlertCircle } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  taskCounts: { total: number; done: number };
}

const STATUS_LABEL: Record<Project['status'], string> = {
  ACTIVE: 'Actif',
  COMPLETED: 'Terminé',
  ARCHIVED: 'Archivé',
};

const STATUS_BADGE_VARIANT: Record<Project['status'], 'success' | 'secondary' | 'outline'> = {
  ACTIVE: 'success',
  COMPLETED: 'secondary',
  ARCHIVED: 'outline',
};

export default function ProjectsPage() {
  const { organizationId, slug, loading: wsLoading } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/projects` : '';
  const { data, loading, error } = useApi<{ projects: Project[] }>(path, { skip: !organizationId });

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setCreating(true);
    setFormError(null);
    try {
      await api(path, { method: 'POST', body: { name } });
      setName('');
      invalidateCache(path);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setCreating(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <AlertDescription>Impossible de charger les projets.</AlertDescription>
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

  if (wsLoading || loading) {
    return <div className="p-8 text-sm text-slate-600">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Projets</h1>
      </header>

      <Card className="mt-4">
        <CardContent className="p-4">
          <form onSubmit={onCreate} className="flex gap-2">
            <Input
              placeholder="Nom du nouveau projet"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Button type="submit" disabled={creating}>
              <Plus className="h-4 w-4" />
              {creating ? 'Création…' : 'Nouveau projet'}
            </Button>
          </form>
          {formError && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-3">
        {(data?.projects.length ?? 0) === 0 && (
          <p className="text-sm text-slate-500">Aucun projet pour l&rsquo;instant.</p>
        )}
        {data?.projects.map((project) => (
          <Link key={project.id} href={`/w/${slug}/projects/${project.id}`}>
            <Card className="transition-colors hover:border-indigo-300">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <FolderKanban className="h-5 w-5 text-indigo-600" />
                  <div>
                    <p className="font-medium text-slate-900">{project.name}</p>
                    {project.description && (
                      <p className="text-sm text-slate-500">{project.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-32">
                    <Progress value={project.taskCounts.done} max={project.taskCounts.total || 1} />
                  </div>
                  <Badge variant={STATUS_BADGE_VARIANT[project.status]}>
                    {STATUS_LABEL[project.status]}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
