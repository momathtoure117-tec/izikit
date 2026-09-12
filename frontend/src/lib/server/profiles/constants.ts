/**
 * CoFound Africa Phase 1 pricing. A single fixed price, not a pricing
 * engine (YAGNI) — bump this constant if the price changes.
 *
 * `PROFILE_UNLOCK_PRICE_FCFA` is enforced server-side in the Bictorys
 * webhook's onPaid handler (see app/api/webhooks/bictorys/route.ts) — that
 * is the ONLY place a ProfileUnlock is granted, so a client cannot unlock a
 * contact by submitting a cheaper amount to POST /api/orders.
 */
export const PROFILE_UNLOCK_PRICE_FCFA = 500;
export const PROFILE_UNLOCK_CURRENCY = 'XOF';
export const PROFILE_UNLOCK_ORDER_TYPE = 'PROFILE_UNLOCK';
