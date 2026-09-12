import { z } from 'zod';

export const ProfileInput = z.object({
  bio: z.string().trim().min(1).max(2000),
  city: z.string().trim().min(1).max(120),
  sector: z.string().trim().min(1).max(120),
  skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  hasIdea: z.boolean().default(false),
  ideaPitch: z.string().trim().max(2000).optional(),
  availableToCofound: z.boolean().default(false),
  externalLink: z.string().trim().url().optional(),
});

export type ProfileInputData = z.infer<typeof ProfileInput>;

export interface ProfileStatusInput {
  bio: string;
  city: string;
  sector: string;
  hasIdea: boolean;
  availableToCofound: boolean;
}

/**
 * A profile becomes publishable once the required fields are filled AND at
 * least one role checkbox is set. SUSPENDED is an admin-only override the
 * caller applies on top of this result — this function never returns it.
 */
export function computeProfileStatus(data: ProfileStatusInput): 'DRAFT' | 'PUBLISHED' {
  const hasRequiredFields =
    data.bio.trim().length > 0 && data.city.trim().length > 0 && data.sector.trim().length > 0;
  const hasRole = data.hasIdea || data.availableToCofound;
  return hasRequiredFields && hasRole ? 'PUBLISHED' : 'DRAFT';
}
