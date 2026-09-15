'use client';

import { AtSign } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface MentionNotification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function MentionsPage() {
  const { loading: wsLoading, notFound } = useWorkspace();
  const { data, loading, error, refresh } = useApi<{ items: MentionNotification[] }>(
    '/api/notifications?type=MENTION',
  );

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les mentions.</AlertDescription>
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

  async function markRead(id: string) {
    try {
      await api('/api/notifications', { method: 'PATCH', body: { ids: [id] } });
      await refresh();
    } catch {
      // best-effort; the item just stays marked unread until the next successful attempt
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <AtSign className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Mentions</h1>
      </header>

      {data.items.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune mention pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-start justify-between gap-3 pt-4">
                <div>
                  <p className="text-sm text-slate-900">{item.body}</p>
                  <span className="text-xs text-slate-400">
                    {new Date(item.createdAt).toLocaleString('fr-FR')}
                  </span>
                </div>
                {item.readAt === null ? (
                  <button
                    type="button"
                    onClick={() => markRead(item.id)}
                    className="shrink-0 text-xs text-indigo-600 hover:underline"
                  >
                    Marquer comme lu
                  </button>
                ) : (
                  <Badge variant="outline" className="shrink-0">
                    Lu
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
