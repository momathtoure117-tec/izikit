'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';

interface Profile {
  id: string;
  bio: string;
  city: string;
  sector: string;
  skills: string[];
  hasIdea: boolean;
  ideaPitch: string | null;
  availableToCofound: boolean;
  externalLink: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
}

const STATUS_LABEL: Record<Profile['status'], string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  SUSPENDED: 'Suspendu',
};

export default function ProfilePage() {
  const user = useUser();
  const { toast } = useToast();
  const { data, loading: profileLoading } = useApi<{ profile: Profile | null }>(
    '/api/profiles/me',
    { skip: !user },
  );

  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [sector, setSector] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [hasIdea, setHasIdea] = useState(false);
  const [ideaPitch, setIdeaPitch] = useState('');
  const [availableToCofound, setAvailableToCofound] = useState(false);
  const [externalLink, setExternalLink] = useState('');
  const [status, setStatus] = useState<Profile['status'] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  // Preload the form from the fetched profile exactly once — after that the
  // form owns its own state (re-running this on every `data` change would
  // stomp on in-progress edits when `invalidateCache` triggers a refetch).
  useEffect(() => {
    if (!data || hydrated) return;
    const p = data.profile;
    if (p) {
      setBio(p.bio);
      setCity(p.city);
      setSector(p.sector);
      setSkills(p.skills);
      setHasIdea(p.hasIdea);
      setIdeaPitch(p.ideaPitch ?? '');
      setAvailableToCofound(p.availableToCofound);
      setExternalLink(p.externalLink ?? '');
      setStatus(p.status);
    }
    setHydrated(true);
  }, [data, hydrated]);

  function addSkillFromInput() {
    const value = skillInput.trim();
    if (value && !skills.includes(value)) {
      setSkills((prev) => [...prev, value]);
    }
    setSkillInput('');
  }

  function removeSkill(skill: string) {
    setSkills((prev) => prev.filter((s) => s !== skill));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    try {
      const res = await api<{ profile: Profile }>('/api/profiles/me', {
        method: 'PUT',
        body: {
          bio,
          city,
          sector,
          skills,
          hasIdea,
          ideaPitch: ideaPitch || undefined,
          availableToCofound,
          externalLink: externalLink || undefined,
        },
      });
      setStatus(res.profile.status);
      invalidateCache('/api/profiles/me');
      toast('Profil enregistré.', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues =
          (err.body.issues as Array<{ path: (string | number)[]; message: string }> | undefined) ??
          [];
        const next: Record<string, string> = {};
        for (const issue of issues) {
          const key = issue.path[0];
          if (typeof key === 'string') next[key] = issue.message;
        }
        setFieldErrors(next);
      } else {
        toast(err instanceof Error ? err.message : 'Erreur inconnue', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  if (profileLoading && !hydrated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
        <p className="text-sm text-gray-600">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mon profil</h1>
        {status && (
          <span className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium">
            {STATUS_LABEL[status]}
          </span>
        )}
      </div>

      {status === 'SUSPENDED' && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Votre profil a été suspendu par un modérateur. Vous pouvez continuer à le modifier, mais
          il ne sera republié qu&apos;après validation.
        </p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Bio
          <textarea
            required
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
          {fieldErrors.bio && <span className="text-xs text-red-600">{fieldErrors.bio}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Ville
          <input
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
          {fieldErrors.city && <span className="text-xs text-red-600">{fieldErrors.city}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Secteur
          <input
            required
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
          {fieldErrors.sector && <span className="text-xs text-red-600">{fieldErrors.sector}</span>}
        </label>

        <div className="flex flex-col gap-1 text-sm">
          Compétences
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => removeSkill(s)}
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs"
                >
                  {s} ×
                </button>
              ))}
            </div>
          )}
          <input
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addSkillFromInput();
              }
            }}
            placeholder="Tape une compétence puis Entrée"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasIdea} onChange={(e) => setHasIdea(e.target.checked)} />
          J&apos;ai une idée
        </label>

        {hasIdea && (
          <label className="flex flex-col gap-1 text-sm">
            Pitch de l&apos;idée
            <textarea
              rows={3}
              value={ideaPitch}
              onChange={(e) => setIdeaPitch(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={availableToCofound}
            onChange={(e) => setAvailableToCofound(e.target.checked)}
          />
          Disponible pour co-fonder
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Lien externe (LinkedIn, portfolio…)
          <input
            value={externalLink}
            onChange={(e) => setExternalLink(e.target.value)}
            placeholder="https://…"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </main>
  );
}
