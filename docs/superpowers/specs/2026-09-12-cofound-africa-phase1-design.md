# CoFound Africa — Phase 1 Design: Profils & Annuaire

## Contexte

CoFound Africa est une plateforme SaaS de matching co-fondateurs pour l'Afrique
francophone (voir brief produit fourni par l'utilisateur). Elle est construite
sur le starter **izikit** (Next.js 16 monolithe, auth/admin/paiements déjà
câblés). Le domaine métier "matching co-fondateurs" est entièrement nouveau.

Le projet est découpé en 3 phases indépendantes, livrées séquentiellement :

1. **Phase 1 (ce document)** — Profils & annuaire filtrable, avec paiement à
   l'unité pour débloquer les coordonnées d'un profil.
2. **Phase 2** — Matching algorithmique / suggestions + mise en relation
   mutuelle. Hors scope ici.
3. **Phase 3** — Messagerie intégrée. Hors scope ici.

Cible utilisateur : entrepreneur sénégalais 25-40 ans, mobile-first, paiement
en Wave/Orange Money. Ton éditorial, sérieux — pas de gamification.

## Modèle de données

Deux nouveaux modèles Prisma, ajoutés à côté des modèles génériques existants
(`User`, `Order`, `AdminAction`, …). Aucun modèle générique n'est renommé.

### `FounderProfile`

Relation 1-1 avec `User`.

| Champ | Type | Notes |
|---|---|---|
| `userId` | `String @unique` | FK vers `User` |
| `bio` | `String` | Texte libre |
| `city` | `String` | Ville/région |
| `sector` | `String` | Secteur d'activité |
| `skills` | `String[]` | Tags de compétences |
| `hasIdea` | `Boolean` | "J'ai une idée" |
| `ideaPitch` | `String?` | Pitch, optionnel, rempli si `hasIdea` |
| `availableToCofound` | `Boolean` | "Disponible pour co-fonder" |
| `externalLink` | `String?` | LinkedIn/portfolio, optionnel |
| `status` | `enum DRAFT \| PUBLISHED \| SUSPENDED` | `DRAFT` par défaut |

Un profil `DRAFT` ou `SUSPENDED` n'apparaît jamais dans l'annuaire public. Le
passage `DRAFT` → `PUBLISHED` se fait quand l'utilisateur remplit les champs
obligatoires (bio, ville, secteur, au moins un des deux booléens `hasIdea` /
`availableToCofound`) et sauvegarde. `SUSPENDED` est un statut admin-only
(voir Modération).

### `ProfileUnlock`

Trace le paiement qui débloque les coordonnées d'un profil pour un autre
utilisateur.

| Champ | Type | Notes |
|---|---|---|
| `unlockerUserId` | `String` | FK vers `User` (celui qui paie) |
| `targetProfileId` | `String` | FK vers `FounderProfile` (celui qui est débloqué) |
| `orderId` | `String @unique` | FK vers `Order` existant (paiement) |
| `unlockedAt` | `DateTime` | Horodatage du déblocage effectif |

Contrainte `@@unique([unlockerUserId, targetProfileId])` — un utilisateur ne
paie qu'une fois par profil cible ; un déblocage existant est permanent (pas
d'expiration en Phase 1).

## Écrans & parcours

1. **Compléter mon profil** (`/profile/edit` ou équivalent) — formulaire
   post-signup pour créer/éditer son `FounderProfile`. Statut affiché
   (brouillon/publié/suspendu).
2. **Annuaire** (`/directory`) — liste des profils `PUBLISHED`, filtrable par
   secteur, compétence, ville, rôle (`hasIdea` / `availableToCofound`).
   Cartes : bio courte + tags, coordonnées masquées.
3. **Détail profil** (`/directory/[id]`) — vue complète. Si l'utilisateur
   courant n'a pas encore de `ProfileUnlock` pour ce profil : bouton
   "Débloquer les coordonnées (500 FCFA)" → déclenche le paiement. Si déjà
   débloqué : email/contact affiché directement.
4. **Mon profil** — vue/édition de son propre `FounderProfile` (peut être la
   même page que #1 en mode édition).
5. **Admin** (`/admin/profiles`, extension du back-office existant) — liste
   des profils avec filtre par statut, action "Suspendre" /
   "Republier" → passe le statut, appelle `logAdminAction` (obligatoire, non
   contournable).

## Paiement (déblocage de contact)

Réutilise l'infra paiement existante sans modifier les fichiers protégés :

- Nouvel `Order` (modèle générique existant) avec `type: 'PROFILE_UNLOCK'` et
  `targetProfileId` en référence, montant **500 FCFA** (entier, sans
  décimales — FCFA n'a pas de sous-unité, invariant du starter).
- Le checkout passe par l'interface `PaymentProvider` déjà câblée (Bictorys
  = Wave/Orange Money).
- Le webhook Bictorys (`frontend/src/lib/server/webhook/bictorys.ts` —
  fichier fair-game, PAS `webhook/handler.ts` qui reste protégé) reçoit la
  confirmation et, via le **pattern outbox obligatoire** (jamais de
  fire-and-forget), crée le `ProfileUnlock` de façon atomique dans la même
  transaction Serializable que le `WebhookLog`.
- Prix configurable plus tard si besoin (constante applicative pour la
  Phase 1, pas de sur-ingénierie avec un système de pricing dynamique).

## Modération admin

Réutilise entièrement l'infra admin existante :
- `requireAdmin` middleware sur les nouvelles routes `/api/admin/profiles/*`.
- Toute mutation (suspendre/republier) passe par `logAdminAction(prisma, {...})`
  — non négociable, invariant du starter.
- Pas de nouveau rôle : `ADMIN` suffit pour modérer les profils.

## Tests

TDD (Vitest, cohérent avec le reste du repo, mocks Prisma via
`frontend/src/test-utils/prisma-mock.ts`) :
- CRUD `FounderProfile` + transition de statut (`DRAFT` → `PUBLISHED`,
  validation des champs obligatoires).
- Filtrage de l'annuaire (secteur/compétence/ville/rôle, exclusion des
  profils non `PUBLISHED`).
- Création d'`Order` de type `PROFILE_UNLOCK` (montant fixe, anti-double-achat
  via la contrainte unique).
- Traitement webhook Bictorys → création `ProfileUnlock` (idempotence,
  outbox).
- Routes admin (suspendre/republier + `AdminAction` bien écrit).

## Hors scope (Phase 1)

- Matching algorithmique / suggestions (Phase 2).
- Messagerie intégrée (Phase 3).
- Vérification d'identité / badges de confiance.
- Expiration des `ProfileUnlock` ou remboursement.
- Pricing dynamique ou abonnement.

## Décisions ouvertes assumées

- Prix de déblocage fixé à **500 FCFA** par défaut à la demande de
  l'utilisateur (validé en session de brainstorming) ; ajustable
  facilement puisqu'il vit comme une constante applicative simple.
