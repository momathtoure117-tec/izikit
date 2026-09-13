'use client';

import { useState, type FormEvent } from 'react';
import { Users, UserPlus, Trash2, AlertCircle } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

interface MembersResponse {
  members: Member[];
}

export default function TeamPage() {
  const { organizationId, role, loading: wsLoading } = useWorkspace();
  const path = organizationId ? `/api/organizations/${organizationId}/members` : '';
  const { data, loading, error, refresh } = useApi<MembersResponse>(path, {
    skip: !organizationId,
  });

  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canManage = role === 'OWNER' || role === 'ADMIN';

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setInviting(true);
    setActionError(null);
    try {
      await api(path, { method: 'POST', body: { email } });
      setEmail('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'USER_NOT_FOUND') {
          setActionError('Aucun compte ne correspond à cet email.');
        } else if (err.code === 'ALREADY_MEMBER') {
          setActionError("Cet utilisateur est déjà membre de l'équipe.");
        } else {
          setActionError(err.message);
        }
      } else {
        setActionError('Erreur inconnue');
      }
    } finally {
      setInviting(false);
    }
  }

  async function onRoleChange(userId: string, newRole: Member['role']) {
    if (!organizationId) return;
    setActionError(null);
    try {
      await api(`${path}/${userId}`, { method: 'PATCH', body: { role: newRole } });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'LAST_OWNER') {
          setActionError('Impossible de retirer le dernier propriétaire.');
        } else {
          setActionError(err.message);
        }
      } else {
        setActionError('Erreur inconnue');
      }
    }
  }

  async function onRemove(userId: string) {
    if (!organizationId) return;
    setActionError(null);
    try {
      await api(`${path}/${userId}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'LAST_OWNER') {
          setActionError('Impossible de supprimer le dernier propriétaire.');
        } else {
          setActionError(err.message);
        }
      } else {
        setActionError('Erreur inconnue');
      }
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <AlertDescription>Impossible de charger l&rsquo;équipe.</AlertDescription>
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
        <Users className="h-6 w-6" />
        Équipe
      </h1>

      {canManage && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Inviter un membre</CardTitle>
            <CardDescription>Ajoute un nouveau membre à l&rsquo;équipe.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="flex gap-2">
              <Input
                type="email"
                placeholder="email@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" disabled={inviting}>
                <UserPlus className="h-4 w-4" />
                Inviter
              </Button>
            </form>
            {actionError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <h2 className="text-lg font-medium text-slate-900">Membres ({data.members.length})</h2>
        {data.members.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun membre pour l&rsquo;instant.</p>
        ) : (
          data.members.map((member) => (
            <Card key={member.userId}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {member.name ?? member.email}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{member.email}</p>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      value={member.role}
                      onChange={(e) =>
                        onRoleChange(member.userId, e.target.value as Member['role'])
                      }
                      className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    >
                      <option value="OWNER">Propriétaire</option>
                      <option value="ADMIN">Admin</option>
                      <option value="MEMBER">Membre</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => onRemove(member.userId)}
                      className="cursor-pointer text-slate-400 hover:text-red-600 transition-colors"
                      aria-label="Retirer ce membre"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <span className="text-sm text-slate-500 flex-shrink-0">{member.role}</span>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
