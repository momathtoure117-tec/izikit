'use client';

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  ListChecks,
  Users,
  Calendar,
  FileText,
  ChevronDown,
  Plus,
  AlertCircle,
  Bell,
} from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/useApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

// Note: the spec's original mockup listed "Tâches" and "Mes tâches" as two
// separate items, but the only tasks route this sub-project builds is the
// cross-project "assigned to me" list (see Task 8) — there is no general
// "all tasks in the workspace" endpoint. Rather than ship two nav items
// pointing at the same page, this collapses them into one ("Mes tâches").
// A future sub-project can reintroduce a separate all-tasks view backed by
// its own route once that's actually needed.
const NAV_ITEMS = [
  { label: 'Tableau de bord', href: 'dashboard', icon: LayoutDashboard },
  { label: 'Projets', href: 'projects', icon: FolderKanban },
  { label: 'Calendrier', href: 'calendar', icon: Calendar },
  { label: 'Mes tâches', href: 'tasks', icon: ListChecks },
  { label: 'Équipe', href: 'team', icon: Users },
  { label: 'Fichiers', href: 'files', icon: FileText },
];

function Sidebar() {
  const { slug, name, organizations, loading, notFound, error } = useWorkspace();
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const { data: notifCount } = useApi<{ count: number }>('/api/notifications/count');

  if (error) {
    return (
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <AlertDescription>Impossible de charger votre espace de travail.</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          onClick={() => window.location.reload()}
        >
          Réessayer
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="relative flex items-center justify-between border-b border-slate-200 p-4">
        <button
          type="button"
          onClick={() => setSwitcherOpen((o) => !o)}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          <span className="truncate">{loading ? 'Chargement…' : name || 'Espace de travail'}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
        <Link
          href={`/w/${slug}/notifications`}
          className="relative ml-2 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {(notifCount?.count ?? 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-semibold text-white">
              {notifCount!.count > 9 ? '9+' : notifCount!.count}
            </span>
          )}
        </Link>
        {switcherOpen && (
          <div className="absolute left-4 right-4 z-10 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-md">
            {organizations.map((org) => (
              <Link
                key={org.id}
                href={`/w/${org.slug}/dashboard`}
                className={cn(
                  'block px-3 py-2 text-sm hover:bg-slate-50',
                  org.slug === slug ? 'font-medium text-indigo-600' : 'text-slate-700',
                )}
                onClick={() => setSwitcherOpen(false)}
              >
                {org.name}
              </Link>
            ))}
            <Link
              href="/onboarding?intent=create"
              className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setSwitcherOpen(false)}
            >
              <Plus className="h-3.5 w-3.5" />
              Créer un espace de travail
            </Link>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Espace de travail
        </p>
        {NAV_ITEMS.map((item) => {
          const hrefPath = item.href.split('?')[0];
          const isActive = pathname === `/w/${slug}/${hrefPath}`;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={`/w/${slug}/${item.href}`}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {notFound && (
        <p className="border-t border-slate-200 p-3 text-xs text-red-600">
          Espace de travail introuvable.
        </p>
      )}
    </aside>
  );
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
