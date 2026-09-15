'use client';

import { Bell } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const { loading: wsLoading, notFound } = useWorkspace();
  const { data, loading, error, refresh } = useApi<{ items: NotificationItem[] }>(
    '/api/notifications',
  );

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les notifications.</AlertDescription>
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
      // best-effort
    }
  }

  async function markAllRead() {
    try {
      await api('/api/notifications', { method: 'PATCH', body: { ids: 'all' } });
      await refresh();
    } catch {
      // best-effort
    }
  }

  const hasUnread = data.items.some((item) => item.readAt === null);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-indigo-600" />
          <h1 className="text-xl font-semibold text-slate-900">Notifications</h1>
        </div>
        {hasUnread && (
          <Button type="button" variant="outline" size="sm" onClick={markAllRead}>
            Tout marquer comme lu
          </Button>
        )}
      </header>

      {data.items.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune notification pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-start justify-between gap-3 pt-4">
                <div>
                  <h3 className="text-sm font-medium text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-700">{item.body}</p>
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
