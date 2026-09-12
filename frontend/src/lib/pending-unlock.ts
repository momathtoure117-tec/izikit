import { COOKIE_PREFIX } from '@/lib/constants';

// Bridges the payment-redirect round-trip: POST /api/orders returns a
// paymentUrl on Bictorys' own hosted-checkout domain, so React state can't
// survive the trip — only `localStorage` can. The profile detail page saves
// the pair right before redirecting; the /orders/[id]/success|failed pages
// read it back to link to the profile that was being unlocked.
const STORAGE_KEY = `${COOKIE_PREFIX}-pending-unlock`;

export interface PendingUnlock {
  orderId: string;
  targetProfileId: string;
}

export function savePendingUnlock(entry: PendingUnlock): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Private browsing / storage disabled — the return pages fall back to
    // their generic (no-profile-link) message, so this is a silent no-op.
  }
}

/** Returns the pending entry only if its `orderId` matches — a stale entry
 * from a different, older unlock attempt must never leak into this one. */
export function readPendingUnlock(orderId: string): PendingUnlock | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingUnlock;
    return parsed.orderId === orderId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingUnlock(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
