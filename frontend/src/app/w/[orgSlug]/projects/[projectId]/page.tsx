'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, AlertCircle, Paperclip, Trash2 as TrashIcon } from 'lucide-react';
import Link from 'next/link';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useUser } from '@/contexts/AuthContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { COOKIE_PREFIX } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WorkspaceNotFound } from '@/components/workspace-not-found';

interface Task {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assigneeId: string | null;
  dueAt: string | null;
}

interface Member {
  userId: string;
  email: string;
  name: string | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  tasks: Task[];
}

interface DocumentRow {
  id: string;
  url: string;
  createdAt: string;
  uploadedById: string;
  fileUpload: { filename: string; mimeType: string; sizeBytes: number };
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

function memberLabel(members: Member[], userId: string): string {
  const match = members.find((m) => m.userId === userId);
  return match ? (match.name ?? match.email) : 'Membre inconnu';
}

// `api()` always JSON-encodes its body, so it cannot send multipart/form-data
// for the upload step — that step uses a raw `fetch()` instead and needs the
// CSRF token read out of the cookie manually.
function readCsrfCookie(): string | null {
  const name = `${COOKIE_PREFIX}-csrf`;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

export default function ProjectDetailPage() {
  const { organizationId, slug, role, loading: wsLoading, notFound: wsNotFound } = useWorkspace();
  const user = useUser();
  const params = useParams<{ projectId: string }>();
  const path = organizationId
    ? `/api/organizations/${organizationId}/projects/${params.projectId}`
    : '';
  const { data, loading, error, refresh } = useApi<{ project: ProjectDetail }>(path, {
    skip: !organizationId,
  });

  // Populates the assignee picker. Without it "Mes tâches" and the dashboard's deadline card have
  // no way to ever be non-empty, since task creation is the only place assignment can happen.
  const { data: membersData } = useApi<{ members: Member[] }>(
    organizationId ? `/api/organizations/${organizationId}/members` : '',
    { skip: !organizationId },
  );
  const members = membersData?.members ?? [];

  const documentsPath = organizationId ? `${path}/documents` : '';
  const {
    data: documentsData,
    error: documentsError,
    refresh: refreshDocuments,
  } = useApi<{ documents: DocumentRow[] }>(documentsPath, { skip: !organizationId });

  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Shared between the upload and delete flows in the Documents section below —
  // only one of those actions can be in flight at a time, and surfacing both
  // kinds of failure through a single Alert keeps the section simple.
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setCreating(true);
    setFormError(null);
    try {
      await api(`${path}/tasks`, {
        method: 'POST',
        body: {
          title,
          // Omit rather than send empty strings — the Zod schema wants a cuid or null.
          ...(assigneeId ? { assigneeId } : {}),
          // <input type="date"> gives "YYYY-MM-DD"; the route's schema wants a full ISO datetime.
          ...(dueDate ? { dueAt: new Date(`${dueDate}T00:00:00.000Z`).toISOString() } : {}),
        },
      });
      setTitle('');
      setAssigneeId('');
      setDueDate('');
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

  async function onUploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !organizationId) return;
    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const csrfToken = readCsrfCookie();
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
      });
      if (!uploadRes.ok) {
        throw new Error('upload failed');
      }
      const uploaded = (await uploadRes.json()) as { id: string; url: string };
      await api(`${path}/documents`, {
        method: 'POST',
        body: { fileUploadId: uploaded.id, url: uploaded.url },
      });
      await refreshDocuments();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Échec de l'envoi du fichier.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onDeleteDocument(documentId: string) {
    if (!organizationId) return;
    setUploadError(null);
    try {
      await api(`/api/organizations/${organizationId}/documents/${documentId}`, {
        method: 'DELETE',
      });
      await refreshDocuments();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FORBIDDEN_NOT_OWNER') {
        setUploadError('Seul le déposant ou un administrateur peut supprimer ce document.');
      } else {
        setUploadError('Erreur réseau.');
      }
    }
  }

  if (wsNotFound) return <WorkspaceNotFound />;

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
          <form onSubmit={onCreateTask} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-title">Titre</Label>
              <Input
                id="task-title"
                placeholder="Titre de la tâche"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="task-assignee">Assigné à</Label>
                <select
                  id="task-assignee"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                >
                  <option value="">Non assigné</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name ?? member.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="task-due">Échéance</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={creating}>
                <Plus className="h-4 w-4" />
                {creating ? 'Ajout…' : 'Ajouter'}
              </Button>
            </div>
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
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                {(task.assigneeId || task.dueAt) && (
                  <p className="truncate text-xs text-slate-500">
                    {task.assigneeId && memberLabel(members, task.assigneeId)}
                    {task.assigneeId && task.dueAt && ' · '}
                    {task.dueAt && new Date(task.dueAt).toLocaleDateString('fr-FR')}
                  </p>
                )}
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

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
          <label className="cursor-pointer">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={onUploadFile}
              disabled={uploading}
            />
            <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Paperclip className="h-4 w-4" />
              {uploading ? 'Envoi…' : 'Ajouter un fichier'}
            </span>
          </label>
        </div>
        {uploadError && (
          <Alert variant="destructive" role="alert" className="mb-3">
            <AlertDescription>{uploadError}</AlertDescription>
          </Alert>
        )}
        {documentsError ? (
          <Alert variant="destructive" role="alert" className="mb-3">
            <AlertDescription>Impossible de charger les documents.</AlertDescription>
          </Alert>
        ) : (documentsData?.documents.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">Aucun document pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {documentsData?.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
              >
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium text-indigo-600 hover:underline"
                >
                  {doc.fileUpload.filename}
                </a>
                {(doc.uploadedById === user?.id || role === 'ADMIN' || role === 'OWNER') && (
                  <button
                    type="button"
                    onClick={() => onDeleteDocument(doc.id)}
                    className="shrink-0 text-slate-400 hover:text-red-600"
                    aria-label={`Supprimer ${doc.fileUpload.filename}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
