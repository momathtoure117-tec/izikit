# CoFound Africa — Phase 1 Design: Écrans UI (Profils & Annuaire)

## Contexte

Le backend de la Phase 1 (voir [2026-09-12-cofound-africa-phase1-design.md](2026-09-12-cofound-africa-phase1-design.md) et son plan d'implémentation, déjà mergés dans `main`) expose :

- `GET/PUT /api/profiles/me` — profil de l'utilisateur courant.
- `GET /api/profiles` — annuaire filtrable (curseur de pagination).
- `GET /api/profiles/[id]` — détail d'un profil, avec `isOwner`/`isUnlocked`/`contactEmail`/`unlockPriceFcfa`.
- `POST /api/orders` (route générique existante, non modifiée) — utilisée pour l'achat du déblocage via `metadata: { type: 'PROFILE_UNLOCK', targetProfileId }`.
- Webhook Bictorys — accorde le `ProfileUnlock` une fois le paiement confirmé, au prix exact.

Ce document couvre uniquement la **couche UI** de cette même Phase 1 : les écrans utilisateur qui consomment ces routes. La modération admin (`/admin/profiles`) est explicitement **hors scope** de cette passe (décision utilisateur) — elle réutilisera le même style plus tard sur le modèle des pages `examples/frontend-pages/admin/*` déjà existantes.

Le starter est headless par design ; ces pages sont écrites directement dans `frontend/src/app/` (pas de fichiers d'exemple à copier — il n'en existe pas encore pour ce domaine).

## Décisions retenues (validées en session de brainstorming)

- **Style visuel** : on garde le style minimaliste déjà utilisé par les pages de référence du starter (`examples/frontend-pages/*`) — Tailwind pur (pas de shadcn/ui), palette noir/blanc/gris, `max-w-md` mobile-first, boutons `rounded-md`. Pas d'identité de marque distincte pour la Phase 1.
- **Filtres de l'annuaire** : barre de filtres repliable (bouton "Filtrer" ouvrant un panneau), pas de filtres toujours visibles — priorité à l'espace pour les cartes sur mobile.
- **Pas de layout/nav partagé** : chaque page gère son propre garde d'authentification via `useUser()` (hook existant de `AuthContext`), comme le font déjà `dashboard.tsx` / `withdrawals.tsx`.

## Routes et inventaire des écrans

| Route | Écran | Rôle |
|---|---|---|
| `frontend/src/app/profile/page.tsx` | Compléter/Mon profil | Formulaire unique (création = édition), badge de statut. |
| `frontend/src/app/directory/page.tsx` | Annuaire | Liste filtrable des profils `PUBLISHED`, pagination par curseur. |
| `frontend/src/app/directory/[id]/page.tsx` | Détail profil | Vue complète + déblocage payant des coordonnées. |
| `frontend/src/app/orders/[id]/success/page.tsx` | Retour paiement OK | Cible fixe de `successUrl` côté `/api/orders` (`${PUBLIC_URL}/orders/${order.id}/success`) — générique à tout type d'`Order`, pas seulement le déblocage. |
| `frontend/src/app/orders/[id]/failed/page.tsx` | Retour paiement échoué | Cible fixe de `failureUrl` (`${PUBLIC_URL}/orders/${order.id}/failed`). |

Ces deux dernières routes n'existent pas encore dans le starter — `/api/orders/route.ts` (fichier fair-game, non protégé) redirige déjà vers ces chemins pour **tout** achat créé via cette route ; les construire fait donc partie de la Phase 1 UI même si elles ne sont pas spécifiques au déblocage de profil.

## Architecture par écran

### 1. `/profile` — Compléter/Mon profil

- `'use client'`, garde via `useUser()` (redirige vers `/login` si non connecté).
- Chargement initial : `useApi<{ profile: Profile | null }>('/api/profiles/me')` pour préremplir le formulaire (vide si `profile: null`).
- Champs : `bio` (textarea), `city`, `sector` (inputs texte libres — pas de listes déroulantes figées, YAGNI), `skills` (saisie "tag" simple : virgule/Entrée → chips retirables), `hasIdea` (case à cocher qui révèle un textarea `ideaPitch`), `availableToCofound` (case à cocher), `externalLink` (input optionnel).
- Badge de statut en haut, dérivé de `profile.status` : Brouillon / Publié / Suspendu (texte simple).
- Si `SUSPENDED` : bandeau d'avertissement informant que le profil a été suspendu par un modérateur et que l'édition ne le republie pas automatiquement (reflète l'invariant serveur : `computeProfileStatus` ne peut jamais sortir un profil de `SUSPENDED`).
- Soumission : `api('/api/profiles/me', { method: 'PUT', body })` → toast de succès (`ToastContext`, déjà branché dans `layout.tsx`) + `invalidateCache('/api/profiles/me')` (de `@/lib/useApi`).
- Erreurs : `VALIDATION_FAILED` (400) → affichage des messages Zod (`issues`) sous les champs concernés, pas de toast générique.

### 2. `/directory` — Annuaire

- Garde `useUser()`.
- État local : filtres (`sector`, `city`, `skill`, `role`) en `useState`, plus le curseur de pagination courant. `role` accepte exactement `'idea' | 'available' | null` (valeurs consommées telles quelles par `GET /api/profiles` — voir `frontend/src/app/api/profiles/route.ts:33`), affichées en UI comme deux boutons/cases "A une idée" / "Dispo pour co-fonder" (mutuellement exclusifs, un seul `role` à la fois côté requête).
- Construit la query string à partir des filtres actifs → `useApi<{ items: ProfileCard[]; nextCursor: string | null }>('/api/profiles?' + qs)`.
- Barre de filtres repliable : bouton "Filtrer" togglant un panneau (`useState<boolean>` + `<div>` conditionnel, pas de librairie de drawer).
- Liste de cartes en une colonne (mobile-first) : bio tronquée, ville, secteur, tags de compétences, badges "a une idée" / "dispo pour co-fonder". Chaque carte est un `<Link href={`/directory/${id}`}>`.
- Pagination : bouton "Charger plus" si `nextCursor` non nul (pas de scroll infini, plus simple à maintenir et à vérifier manuellement).
- Annuaire vide (`items: []`) : message explicite "Aucun profil ne correspond à ces critères" plutôt qu'une liste silencieusement vide.

### 3. `/directory/[id]` — Détail profil

- Garde `useUser()`.
- `useApi<{ profile: ProfileDetail }>('/api/profiles/' + id)`.
- 404 (`PROFILE_NOT_FOUND`) → écran "Profil introuvable" + lien retour vers `/directory`.
- Si `profile.isOwner` : coordonnées affichées directement (c'est déjà son propre profil) + lien "Modifier mon profil" vers `/profile`. Le bouton de déblocage n'est **jamais affiché** dans ce cas.
- Sinon si `profile.isUnlocked` : coordonnées (`contactEmail`) affichées directement.
- Sinon : bouton "Débloquer les coordonnées (`profile.unlockPriceFcfa` FCFA)". Au clic :
  1. `api('/api/orders', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { amount: profile.unlockPriceFcfa, currency: 'XOF', metadata: { type: 'PROFILE_UNLOCK', targetProfileId: id } } })`.
  2. Avant redirection, stocke `{ orderId, targetProfileId: id }` dans `localStorage['app-pending-unlock']` (cohérent avec l'usage déjà fait de `localStorage` pour le jeton CSRF dans `lib/api.ts`).
  3. `window.location.href = res.paymentUrl`.
  - Erreurs (switch sur `ApiError.code`) :
    - `PAYMENT_PROVIDER_UNCONFIGURED` / `PAYMENT_PROVIDER_UNAVAILABLE` → "Paiement momentanément indisponible, réessaie dans un instant" ; si `Retry-After` est présent, désactive le bouton pendant ce délai.
    - `PAYMENT_FAILED` → "Le paiement a échoué, réessaie."
    - Autre / réseau → message générique + bouton "Réessayer" qui régénère un nouvel `Idempotency-Key`.

**Limitation acceptée (documentée, pas un bug) :** rien côté serveur n'empêche explicitement un utilisateur de payer pour débloquer son propre profil (ni `/api/orders`, ni le webhook `onPaid` ne vérifient `order.userId !== targetProfile.userId`). Le garde-fou est uniquement côté UI : le bouton n'est jamais rendu quand `isOwner` est vrai. Le pire cas serait une auto-facturation sans bénéfice (le contact est déjà visible gratuitement) — aucun risque de fraude envers un tiers. Une garde serveur pourrait être ajoutée plus tard sans redesign.

### 4. `/orders/[id]/success` et `/orders/[id]/failed`

- Pages simples, sans garde d'authentification stricte (cohérent avec le fait que `successUrl`/`failureUrl` sont des redirections navigateur post-paiement, potentiellement après une session ayant expiré entre-temps).
- Lisent `localStorage['app-pending-unlock']` : si l'`orderId` stocké correspond au segment `[id]` de l'URL, affichent un lien direct "Voir le profil débloqué" vers `/directory/{targetProfileId}`.
  - Sur la page succès : note explicite que la confirmation peut prendre quelques secondes (le webhook Bictorys est asynchrone — le `ProfileUnlock` n'est pas garanti d'exister au moment de l'affichage de cette page).
  - Sur la page échec : pas de lien de re-tentative automatique — l'utilisateur retourne sur `/directory/{targetProfileId}` pour relancer un nouveau déblocage.
- Si aucune correspondance en `localStorage` (navigation directe, autre type d'achat, ou stockage vidé) : message générique de confirmation/échec + lien vers `/directory`.

## Gestion des erreurs — résumé transverse

- **401** : déjà géré globalement par `api()` (refresh silencieux à usage unique) et par `useUser()` (redirection vers `/login`) — aucune gestion spécifique par écran.
- **États de chargement** : texte simple "Chargement…", cohérent avec `dashboard.tsx` — pas de skeletons.
- **Toasts** : uniquement pour les confirmations d'action explicites (sauvegarde de profil réussie) — pas pour les erreurs de validation de formulaire, qui s'affichent inline.

## Tests

Ce starter ne teste pas les pages UI par des suites automatisées (`examples/frontend-pages/*` n'ont pas de fichiers `.test.tsx`), et CLAUDE.md demande une vérification manuelle au navigateur pour les changements frontend plutôt que des tests Vitest. Cette Phase 1 UI suit le même principe : pas de suite de tests dédiée, mais un parcours manuel complet via `pnpm dev` avant de considérer le travail terminé :

1. Créer un compte A, compléter son profil (vérifier transition Brouillon → Publié).
2. Créer un compte B, retrouver le profil de A dans l'annuaire (filtres), ouvrir le détail (coordonnées masquées).
3. Débloquer depuis B (paiement Bictorys en mode test), vérifier la redirection succès et l'apparition des coordonnées après confirmation webhook.
4. Vérifier qu'un profil `DRAFT` n'apparaît pas dans l'annuaire, et que le propriétaire voit toujours ses propres coordonnées sans bouton de déblocage.

## Hors scope (cette passe UI)

- Écran de modération admin `/admin/profiles` (reporté — même style, plus tard).
- Garde serveur anti-auto-déblocage (voir limitation acceptée ci-dessus).
- Recherche plein-texte, tri autre que `createdAt desc`, favoris/liste de suivi.
- Design de marque dédié (palette/typographie CoFound Africa) — le style minimal du starter est conservé pour cette phase.
