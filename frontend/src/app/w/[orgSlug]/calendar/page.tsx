'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceNotFound } from '@/components/workspace-not-found';
import { useApi } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface CalendarEventRow {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  createdById: string;
}

interface TaskDeadlineRow {
  id: string;
  title: string;
  dueAt: string;
  project: { id: string; name: string };
}

interface CalendarResponse {
  events: CalendarEventRow[];
  taskDeadlines: TaskDeadlineRow[];
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(year: number, month0: number): Date[] {
  const days: Date[] = [];
  const d = new Date(Date.UTC(year, month0, 1));
  while (d.getUTCMonth() === month0) {
    days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

export default function CalendarPage() {
  const { organizationId, loading: wsLoading, notFound } = useWorkspace();
  const [cursor, setCursor] = useState(() => new Date());
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const month = monthKey(cursor);
  const path = organizationId
    ? `/api/organizations/${organizationId}/calendar-events?month=${month}`
    : '';
  const { data, loading, error, refresh } = useApi<CalendarResponse>(path, {
    skip: !organizationId,
  });

  const days = useMemo(() => daysInMonth(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  if (notFound) return <WorkspaceNotFound />;

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger le calendrier.</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (wsLoading || loading || !data) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-slate-500">Chargement…</div>;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim() || !startAt) {
      setFormError('Le titre et la date sont obligatoires.');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/organizations/${organizationId}/calendar-events`, {
        method: 'POST',
        body: { title: title.trim(), startAt: new Date(startAt).toISOString() },
      });
      setTitle('');
      setStartAt('');
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(eventId: string) {
    setMutationError(null);
    try {
      await api(`/api/organizations/${organizationId}/calendar-events/${eventId}`, {
        method: 'DELETE',
      });
      await refresh();
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : 'Erreur réseau.');
    }
  }

  const eventsByDay = new Map<string, CalendarEventRow[]>();
  const deadlinesByDay = new Map<string, TaskDeadlineRow[]>();
  for (const ev of data.events) {
    const key = ev.startAt.slice(0, 10);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), ev]);
  }
  for (const t of data.taskDeadlines) {
    const key = t.dueAt.slice(0, 10);
    deadlinesByDay.set(key, [...(deadlinesByDay.get(key) ?? []), t]);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-indigo-600" />
          <h1 className="text-xl font-semibold text-slate-900">Calendrier</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-slate-700">
            {cursor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-title">Titre</Label>
              <Input
                id="event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Réunion équipe"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-start">Date</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting} className="gap-2">
              <Plus className="h-4 w-4" />
              {submitting ? 'Ajout…' : 'Nouvel événement'}
            </Button>
          </form>
          {formError && (
            <Alert variant="destructive" role="alert" className="mt-3">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const dayEvents = eventsByDay.get(key) ?? [];
          const dayDeadlines = deadlinesByDay.get(key) ?? [];
          if (dayEvents.length === 0 && dayDeadlines.length === 0) return null;
          return (
            <Card key={key}>
              <CardContent className="flex flex-col gap-2 pt-4">
                <span className="text-xs font-semibold text-slate-500">
                  {day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
                {dayEvents.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-900">{ev.title}</span>
                    <button
                      type="button"
                      onClick={() => onDelete(ev.id)}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Supprimer ${ev.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {dayDeadlines.map((t) => (
                  <div key={t.id} className="text-sm text-indigo-700">
                    {t.title} <span className="text-xs text-slate-400">({t.project.name})</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
        {days.every((day) => {
          const key = day.toISOString().slice(0, 10);
          return (
            (eventsByDay.get(key)?.length ?? 0) === 0 &&
            (deadlinesByDay.get(key)?.length ?? 0) === 0
          );
        }) && <p className="text-sm text-slate-500">Aucun événement ce mois-ci.</p>}
      </div>

      {mutationError && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
