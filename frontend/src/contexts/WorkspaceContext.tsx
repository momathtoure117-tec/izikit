'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

interface WorkspaceContextValue {
  organizationId: string | null;
  slug: string;
  name: string;
  role: WorkspaceSummary['role'] | null;
  organizations: WorkspaceSummary[];
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const params = useParams<{ orgSlug: string }>();
  const slug = params.orgSlug;
  const [organizations, setOrganizations] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<{ organizations: WorkspaceSummary[] }>('/api/organizations')
      .then((res) => {
        if (!cancelled) setOrganizations(res.organizations);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = organizations.find((o) => o.slug === slug) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        organizationId: current?.id ?? null,
        slug,
        name: current?.name ?? '',
        role: current?.role ?? null,
        organizations,
        loading,
        notFound: !loading && !error && current === null,
        error,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside a WorkspaceProvider');
  return ctx;
}
