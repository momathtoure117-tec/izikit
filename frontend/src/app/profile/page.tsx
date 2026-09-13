'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

const STATUS_BADGE_VARIANT: Record<Profile['status'], 'secondary' | 'success' | 'destructive'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'success',
  SUSPENDED: 'destructive',
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
          ideaPitch: hasIdea ? ideaPitch : '',
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
        toast('Merci de corriger les champs indiqués en rouge.', 'error');
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
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-500">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 bg-slate-50 px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl">Mon profil</CardTitle>
            {status && <Badge variant={STATUS_BADGE_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {status === 'SUSPENDED' && (
            <Alert variant="destructive">
              <AlertDescription>
                Ton profil a été suspendu par un modérateur. Tu peux continuer à le modifier, mais
                il ne sera republié qu&apos;après validation.
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                required
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
              {fieldErrors.bio && <span className="text-xs text-red-600">{fieldErrors.bio}</span>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="city">Ville</Label>
              <Input id="city" required value={city} onChange={(e) => setCity(e.target.value)} />
              {fieldErrors.city && <span className="text-xs text-red-600">{fieldErrors.city}</span>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sector">Secteur</Label>
              <Input
                id="sector"
                required
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              />
              {fieldErrors.sector && (
                <span className="text-xs text-red-600">{fieldErrors.sector}</span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skillInput">Compétences</Label>
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {skills.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => removeSkill(s)}
                      aria-label={`Retirer ${s}`}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      {s}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
              <Input
                id="skillInput"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addSkillFromInput();
                  }
                }}
                placeholder="Tape une compétence puis Entrée"
              />
              {fieldErrors.skills && (
                <span className="text-xs text-red-600">{fieldErrors.skills}</span>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={hasIdea}
                onChange={(e) => setHasIdea(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              J&apos;ai une idée
            </label>

            {hasIdea && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ideaPitch">Pitch de l&apos;idée</Label>
                <Textarea
                  id="ideaPitch"
                  rows={3}
                  value={ideaPitch}
                  onChange={(e) => setIdeaPitch(e.target.value)}
                />
                {fieldErrors.ideaPitch && (
                  <span className="text-xs text-red-600">{fieldErrors.ideaPitch}</span>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={availableToCofound}
                onChange={(e) => setAvailableToCofound(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Disponible pour co-fonder
            </label>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="externalLink">Lien externe (LinkedIn, portfolio…)</Label>
              <Input
                id="externalLink"
                value={externalLink}
                onChange={(e) => setExternalLink(e.target.value)}
                placeholder="https://…"
              />
              {fieldErrors.externalLink && (
                <span className="text-xs text-red-600">{fieldErrors.externalLink}</span>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
