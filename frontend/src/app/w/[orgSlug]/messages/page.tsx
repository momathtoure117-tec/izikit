'use client';

import { useState, type FormEvent } from 'react';
import { MessageSquare } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { MentionInput, renderMessageBody } from '@/components/mention-input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface MessageRow {
  id: string;
  body: string;
  authorId: string;
  projectId: string | null;
  createdAt: string;
}

interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

export default function MessagesPage() {
  const { organizationId, loading: wsLoading, notFound } = useWorkspace();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const messagesPath = organizationId ? `/api/organizations/${organizationId}/messages` : '';
  const { data, loading, error, refresh } = useApi<{ messages: MessageRow[] }>(messagesPath, {
    skip: !organizationId,
  });

  const membersPath = organizationId ? `/api/organizations/${organizationId}/members` : '';
  const { data: membersData } = useApi<{ members: MemberRow[] }>(membersPath, {
    skip: !organizationId,
  });

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les messages.</AlertDescription>
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

  function resolveName(userId: string): string {
    const match = membersData?.members.find((m) => m.userId === userId);
    return match ? (match.name ?? match.email) : 'Membre inconnu';
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    setSendError(null);
    if (!draft.trim()) return;
    setSending(true);
    try {
      await api(`/api/organizations/${organizationId}/messages`, {
        method: 'POST',
        body: { body: draft.trim() },
      });
      setDraft('');
      await refresh();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Messagerie</h1>
      </header>

      <div className="mb-4 flex flex-1 flex-col gap-3 overflow-y-auto">
        {data.messages.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun message pour l&apos;instant.</p>
        ) : (
          data.messages.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">
                  {resolveName(m.authorId)}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(m.createdAt).toLocaleString('fr-FR')}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {renderMessageBody(m.body)}
              </p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSend} className="flex flex-col gap-2">
        <MentionInput
          value={draft}
          onChange={setDraft}
          members={membersData?.members ?? []}
          placeholder="Écrivez un message… (@ pour mentionner)"
        />
        {sendError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{sendError}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={sending} className="self-end">
          {sending ? 'Envoi…' : 'Envoyer'}
        </Button>
      </form>
    </div>
  );
}
