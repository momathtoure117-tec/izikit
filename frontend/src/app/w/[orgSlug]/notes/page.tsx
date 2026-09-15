'use client';

import { useState, type FormEvent } from 'react';
import { StickyNote, Pencil, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useUser } from '@/contexts/AuthContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface NoteRow {
  id: string;
  title: string;
  body: string;
  authorId: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'FORBIDDEN_NOT_OWNER') {
    return 'Seul l’auteur ou un administrateur peut modifier cette note.';
  }
  return 'Erreur réseau.';
}

export default function NotesPage() {
  const { organizationId, role, loading: wsLoading, notFound } = useWorkspace();
  const user = useUser();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  const notesPath = organizationId ? `/api/organizations/${organizationId}/notes` : '';
  const { data, loading, error, refresh } = useApi<{ notes: NoteRow[] }>(notesPath, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les notes.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  function canEdit(note: NoteRow): boolean {
    return note.authorId === user?.id || role === 'ADMIN' || role === 'OWNER';
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim() || !body.trim()) {
      setFormError('Le titre et le contenu sont obligatoires.');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/organizations/${organizationId}/notes`, {
        method: 'POST',
        body: { title: title.trim(), body: body.trim() },
      });
      setTitle('');
      setBody('');
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(note: NoteRow) {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditBody(note.body);
    setMutationError(null);
  }

  async function onSaveEdit(noteId: string) {
    try {
      await api(`/api/organizations/${organizationId}/notes/${noteId}`, {
        method: 'PATCH',
        body: { title: editTitle.trim(), body: editBody.trim() },
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setMutationError(errorMessage(err));
    }
  }

  async function onDelete(noteId: string) {
    setMutationError(null);
    try {
      await api(`/api/organizations/${organizationId}/notes/${noteId}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setMutationError(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <StickyNote className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Notes</h1>
      </header>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={onCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note-title">Titre</Label>
              <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note-body">Contenu</Label>
              <Textarea
                id="note-body"
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            {formError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="self-end">
              {submitting ? 'Ajout…' : 'Ajouter la note'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {mutationError && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      )}

      {data.notes.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune note pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.notes.map((note) => (
            <Card key={note.id}>
              <CardContent className="pt-4">
                {editingId === note.id ? (
                  <div className="flex flex-col gap-2">
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    <Textarea
                      rows={3}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => onSaveEdit(note.id)}>
                        Enregistrer
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h3 className="font-medium text-slate-900">{note.title}</h3>
                      {canEdit(note) && (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(note)}
                            className="text-slate-400 hover:text-indigo-600"
                            aria-label={`Modifier ${note.title}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(note.id)}
                            className="text-slate-400 hover:text-red-600"
                            aria-label={`Supprimer ${note.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
                    {note.project && (
                      <span className="mt-2 inline-block text-xs text-indigo-600">
                        {note.project.name}
                      </span>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
