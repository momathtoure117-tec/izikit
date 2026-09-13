'use client';

import Link from 'next/link';
import {
  Sparkles,
  FolderKanban,
  ListChecks,
  CheckCircle2,
  Users,
  Plus,
  AlertCircle,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi } from '@/lib/useApi';
import { buttonVariants, Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { WorkspaceNotFound } from '@/components/workspace-not-found';

interface DashboardSummary {
  activeProjectsCount: number;
  tasksInProgressCount: number;
  tasksDoneCount: number;
  memberCount: number;
  upcomingDeadlines: {
    id: string;
    title: string;
    dueAt: string;
    project: { id: string; name: string };
  }[];
  recentActivity: { type: 'project' | 'task'; id: string; title: string; updatedAt: string }[];
  projectsProgress: { id: string; name: string; total: number; done: number }[];
}

export default function DashboardPage() {
  const { organizationId, slug, loading: wsLoading, notFound: wsNotFound } = useWorkspace();
  const { data, loading, error } = useApi<DashboardSummary>(
    organizationId ? `/api/organizations/${organizationId}/dashboard` : '',
    { skip: !organizationId },
  );

  if (wsNotFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <AlertDescription>Impossible de charger le tableau de bord.</AlertDescription>
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
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            Bonjour
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Voici ce qui se passe dans votre espace de travail aujourd&rsquo;hui.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/w/${slug}/projects`} className={buttonVariants({ variant: 'outline' })}>
            <Plus className="h-4 w-4" />
            Nouveau projet
          </Link>
          <Link href={`/w/${slug}/projects`} className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            Nouvelle tâche
          </Link>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <FolderKanban className="h-4 w-4 text-indigo-600" />
            <span className="text-2xl font-semibold text-slate-900">
              {data.activeProjectsCount}
            </span>
            <span className="text-xs text-slate-500">Projets actifs</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <ListChecks className="h-4 w-4 text-indigo-600" />
            <span className="text-2xl font-semibold text-slate-900">
              {data.tasksInProgressCount}
            </span>
            <span className="text-xs text-slate-500">Tâches en cours</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-2xl font-semibold text-slate-900">{data.tasksDoneCount}</span>
            <span className="text-xs text-slate-500">Tâches terminées</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <Users className="h-4 w-4 text-indigo-600" />
            <span className="text-2xl font-semibold text-slate-900">{data.memberCount}</span>
            <span className="text-xs text-slate-500">Membres de l&rsquo;équipe</span>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progression des projets</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.projectsProgress.length === 0 && (
              <p className="text-sm text-slate-500">Aucun projet actif.</p>
            )}
            {data.projectsProgress.map((p) => (
              <div key={p.id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className="text-slate-500">
                    {p.done}/{p.total}
                  </span>
                </div>
                <Progress value={p.done} max={p.total || 1} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Échéances à venir</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.upcomingDeadlines.length === 0 && (
              <p className="text-sm text-slate-500">Aucune échéance dans les 7 prochains jours.</p>
            )}
            {data.upcomingDeadlines.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-500">{t.project.name}</p>
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(t.dueAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Activité récente</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.recentActivity.length === 0 && (
              <p className="text-sm text-slate-500">Aucune activité récente.</p>
            )}
            {data.recentActivity.map((a) => (
              <div key={`${a.type}-${a.id}`} className="flex items-center justify-between text-sm">
                <span className="text-slate-900">
                  {a.type === 'project' ? 'Projet' : 'Tâche'} — {a.title}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(a.updatedAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
