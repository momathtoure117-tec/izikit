import { describe, it, expect } from 'vitest';
import { ProfileInput, computeProfileStatus } from './validation';

describe('ProfileInput', () => {
  it('parses a full valid payload', () => {
    const result = ProfileInput.safeParse({
      bio: 'I build fintech products.',
      city: 'Dakar',
      sector: 'Fintech',
      skills: ['React', 'Node.js'],
      hasIdea: true,
      ideaPitch: 'A mobile money aggregator.',
      availableToCofound: false,
      externalLink: 'https://linkedin.com/in/me',
    });
    expect(result.success).toBe(true);
  });

  it('defaults skills/hasIdea/availableToCofound when omitted', () => {
    const result = ProfileInput.safeParse({ bio: 'Bio', city: 'Dakar', sector: 'Tech' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual([]);
      expect(result.data.hasIdea).toBe(false);
      expect(result.data.availableToCofound).toBe(false);
    }
  });

  it('rejects an empty bio', () => {
    const result = ProfileInput.safeParse({ bio: '', city: 'Dakar', sector: 'Tech' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL externalLink', () => {
    const result = ProfileInput.safeParse({
      bio: 'Bio',
      city: 'Dakar',
      sector: 'Tech',
      externalLink: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('computeProfileStatus', () => {
  const base = {
    bio: 'Bio',
    city: 'Dakar',
    sector: 'Tech',
    hasIdea: false,
    availableToCofound: false,
  };

  it('PUBLISHED when required fields are filled and hasIdea is true', () => {
    expect(computeProfileStatus({ ...base, hasIdea: true })).toBe('PUBLISHED');
  });

  it('PUBLISHED when required fields are filled and availableToCofound is true', () => {
    expect(computeProfileStatus({ ...base, availableToCofound: true })).toBe('PUBLISHED');
  });

  it('DRAFT when required fields are filled but no role is checked', () => {
    expect(computeProfileStatus(base)).toBe('DRAFT');
  });

  it('DRAFT when bio is empty even if a role is checked', () => {
    expect(computeProfileStatus({ ...base, bio: '', hasIdea: true })).toBe('DRAFT');
  });
});
