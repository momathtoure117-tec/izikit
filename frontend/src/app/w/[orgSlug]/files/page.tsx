'use client';

import { useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useUser } from '@/contexts/AuthContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface DocumentRow {
  id: string;
  url: string;
  createdAt: string;
  uploadedById: string;
  project: { id: string; name: string };
  fileUpload: { filename: string; mimeType: string; sizeBytes: number };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function FilesPage() {
  const { organizationId, role, loading: wsLoading, notFound } = useWorkspace();
  const user = useUser();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const path = organizationId ? `/api/organizations/${organizationId}/documents` : '';
  const { data, loading, error, refresh } = useApi<{ documents: DocumentRow[] }>(path, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les fichiers.</AlertDescription>
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

  async function onDelete(documentId: string) {
    setMutationError(null);
    try {
      await api(`/api/organizations/${organizationId}/documents/${documentId}`, {
        method: 'DELETE',
      });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FORBIDDEN_NOT_OWNER') {
        setMutationError('Seul le déposant ou un administrateur peut supprimer ce document.');
      } else {
        setMutationError('Erreur réseau.');
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <FileText className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Fichiers</h1>
      </header>

      {data.documents.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun fichier pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between gap-3 pt-4">
                <div className="flex min-w-0 flex-col">
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-medium text-indigo-600 hover:underline"
                  >
                    {doc.fileUpload.filename}
                  </a>
                  <span className="text-xs text-slate-500">
                    {doc.project.name} · {formatBytes(doc.fileUpload.sizeBytes)} ·{' '}
                    {new Date(doc.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                {(doc.uploadedById === user?.id || role === 'ADMIN' || role === 'OWNER') && (
                  <button
                    type="button"
                    onClick={() => onDelete(doc.id)}
                    className="shrink-0 text-slate-400 hover:text-red-600"
                    aria-label={`Supprimer ${doc.fileUpload.filename}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {mutationError && (
        <Alert variant="destructive" role="alert" className="mt-4">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
