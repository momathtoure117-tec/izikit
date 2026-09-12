# CoFound Africa — Modération admin des profils (`/admin/profiles`)

## Contexte

Le backend de modération admin de la Phase 1 (déjà mergé dans `main`) expose :

- `GET /api/admin/profiles?status=&cursor=&limit=` — liste paginée par curseur des `FounderProfile`, avec un filtre optionnel `status` (`DRAFT`/`PUBLISHED`/`SUSPENDED`). Réservé aux rôles `ADMIN`/`SUPERADMIN` (`requireAdmin('ADMIN')`). Retourne `{ items, nextCursor }` avec par item : `id, userId, bio, city, sector, skills, hasIdea, availableToCofound, status, createdAt, user: { email }` — **ne retourne pas** `ideaPitch` ni `externalLink`.
- `PATCH /api/admin/profiles/[id]/status` — body `{ status: 'PUBLISHED' | 'SUSPENDED', reason?: string }` (raison 1-500 caractères). Réservé aux rôles `ADMIN`/`SUPERADMIN`. Idempotent (si le profil est déjà dans le statut demandé, renvoie 200 sans réécrire ni relogger). Journalise chaque changement réel via `logAdminAction` (`profile.suspend` / `profile.publish`) avec `{ from, to, reason? }` en métadonnées. 404 `PROFILE_NOT_FOUND` si le profil n'existe plus.
- `GET /api/admin/me` — probe d'authentification admin, retourne `{ admin: { id, email, role }, can: string[] }`. La liste `can` est un contrat verrouillé (`D-ADMIN-04`) qui ne contient aucune capacité `profiles:*` — non modifiée par cette passe. L'autorisation réelle est de toute façon revérifiée indépendamment par `requireAdmin('ADMIN')` sur chaque route mutante ; cette page s'appuie uniquement sur le succès (200) de cet appel pour savoir qu'un rôle admin est authentifié.

Aucune page `/admin/*` n'existe encore dans l'app réelle — les fichiers sous `examples/frontend-pages/admin/*` sont des références jamais copiées. Cette passe construit uniquement `/admin/profiles`, de façon autonome (pas de layout/nav admin partagé) — cohérent avec le choix déjà fait pour les écrans fondateurs de la Phase 1 UI. Le reste du back-office (users/orders/withdrawals/audit-log) reste hors scope.

## Décisions retenues (validées en session de brainstorming)

- **Périmètre** : uniquement `/admin/profiles`, page autonome avec son propre garde d'accès — pas de bootstrap du back-office complet.
- **Niveau de détail** : le tableau liste seule suffit (bio/ville/secteur/compétences/statut) ; pas de vue détail séparée, pas de modification du `SELECT` du endpoint existant.
- **Filtre par défaut** : `PUBLISHED` à l'ouverture, avec un sélecteur pour basculer vers `SUSPENDED` / `DRAFT`.
- **Raison de suspension** : obligatoire (1-500 caractères) pour suspendre ; absente/optionnelle pour republier.
- **Pattern de fetch** : état manuel + appels directs `api()` (`load(reset: boolean)`), sur le modèle de `examples/frontend-pages/admin/users.tsx` — **pas** le hook `useApi`. Choix délibéré : la revue finale de la Phase 1 UI fondateur a révélé une classe de bugs de timing propres à `useApi` (état `loading` obsolète sur la transition `skip: true → false`). Le pattern `load(reset)` gère explicitement remplacement/ajout à l'appel, ce qui évite structurellement cette classe de bug.

## Architecture et route

- `frontend/src/app/admin/profiles/page.tsx`, `'use client'`.
- Garde d'accès au montage : `api('/api/admin/me')`. Succès (200) → rend la page. Échec (401/403 via `ApiError`, ou toute autre erreur, par sécurité) → `router.replace('/')`, même logique que `examples/frontend-pages/admin/layout.tsx`. Écran de transition : "Vérification de l'accès…".
- Aucune modification backend. Les deux endpoints existants sont utilisés tels quels.

## Composants et flux de données

### État local

```
profiles: AdminProfile[]
statusFilter: 'PUBLISHED' | 'SUSPENDED' | 'DRAFT'   // défaut 'PUBLISHED'
cursor: string | null
hasMore: boolean
loading: boolean
error: string | null
expandedReasonId: string | null   // id du profil dont le champ raison est ouvert
reasonDraft: Record<string, string>   // brouillon de raison par profil, survit à un échec de soumission
actionError: Record<string, string>   // erreur de validation inline par profil (ex. raison trop courte)
submitting: Record<string, boolean>   // profil en cours de traitement (désactive ses boutons)
```

### Chargement

`async function load(reset: boolean)` :
1. `setLoading(true)`, `setError(null)`.
2. Construit les query params (`status=statusFilter`, `cursor` si `!reset && cursor`, `limit=50`).
3. `GET /api/admin/profiles?...`.
4. Succès : `setProfiles(prev => reset ? res.items : [...prev, ...res.items])`, `setCursor(res.nextCursor)`, `setHasMore(!!res.nextCursor)`.
5. Échec : `setError(...)` (pas de toast — l'erreur de liste est un état persistant affiché inline, pas un événement transitoire).
6. `finally`: `setLoading(false)`.

Appelé au montage (`reset: true`) et à chaque changement de `statusFilter` (`reset: true`). Le bouton "Charger plus" appelle `load(false)`.

### Tableau

Colonnes : Email (propriétaire) · Bio (tronquée, `line-clamp`) · Ville · Secteur · Compétences (tags) · Rôle (badges "A une idée" / "Dispo pour co-fonder") · Statut (badge) · Créé le · Actions.

### Filtre de statut

Trois boutons segmentés (Publié / Suspendu / Brouillon), style actif/inactif identique aux boutons de rôle de l'écran `/directory`. Changer le filtre réinitialise `cursor`/`profiles` via `load(true)`.

### Action Suspendre (profil `PUBLISHED`)

1. Clic sur "Suspendre" → `setExpandedReasonId(profile.id)`, déploie un `<textarea>` inline (obligatoire) + boutons "Confirmer"/"Annuler" dans la même ligne.
2. "Annuler" → referme le champ, ne vide pas `reasonDraft` (l'admin peut rouvrir sans retaper).
3. "Confirmer" : validation client (`reason.trim().length >= 1`, sinon `actionError[id] = 'La raison est requise.'`, pas de requête envoyée). Sinon `setSubmitting({...,[id]:true})`, `PATCH /api/admin/profiles/[id]/status { status: 'SUSPENDED', reason }`.
4. Succès : toast "Profil suspendu.", referme le champ, vide `reasonDraft[id]`. Si `statusFilter !== 'SUSPENDED'` (donc `'PUBLISHED'` ou `'DRAFT'`), le profil ne correspond plus au filtre courant → retiré de `profiles` (`setProfiles(prev => prev.filter(p => p.id !== id))`) plutôt que laissé affiché avec un badge qui contredit le filtre actif. Si `statusFilter === 'SUSPENDED'` (cas déjà couvert par l'idempotence serveur, improbable dans ce flux), le statut est simplement mis à jour en place.

### Action Republier (profil `SUSPENDED`)

Un clic direct sur "Republier" → `PATCH /api/admin/profiles/[id]/status { status: 'PUBLISHED' }` (pas de `reason`). Succès : toast "Profil republié.". Même règle qu'à la suspension : si `statusFilter !== 'PUBLISHED'`, le profil est retiré de `profiles` (ne correspond plus au filtre courant) ; sinon son statut est mis à jour en place.

### Pagination

Bouton "Charger plus" si `hasMore`, appelle `load(false)`, désactivé pendant `loading`.

## Gestion des erreurs — résumé transverse

- **Garde d'accès** : 401/403 sur `/api/admin/me` → redirection `/`.
- **Erreur de chargement de liste** : bannière inline (pas un toast) + bouton "Réessayer" (`onClick={() => load(true)}`), distincte de "aucun profil" (`!loading && !error && profiles.length === 0`).
- **Liste vide** : "Aucun profil ne correspond à ce filtre."
- **Erreurs PATCH**, switch sur `ApiError.code` :
  - `VALIDATION_FAILED` → erreur inline sous le champ raison (`actionError[id]`), pas de toast générique.
  - `PROFILE_NOT_FOUND` → toast "Ce profil n'existe plus." + retrait de la ligne de `profiles`.
  - Autre `ApiError` (incluant un 429 du rate-limiter admin) → toast avec un message générique fixe (jamais `err.message` brut — même principe que la Phase 1 UI fondateur, pour ne pas exposer de texte serveur non traduit).
  - Erreur réseau (non-`ApiError`) → toast générique.
  - Dans tous les cas d'échec de suspension : `reasonDraft[id]` n'est pas vidé (l'admin ne retape pas sa raison après une erreur transitoire).
- **Concurrence entre admins** : acceptée sans verrou UI. Le serveur est idempotent sur un statut déjà atteint (pas de double-log d'audit) ; l'UI reflète simplement le dernier état renvoyé par le serveur, avec `PROFILE_NOT_FOUND` géré explicitement comme cas limite (profil supprimé entre-temps — improbable aujourd'hui, mais géré proprement).

## Tests

Même convention que la Phase 1 UI fondateur : pas de suite automatisée pour cette page (le starter ne teste pas les pages UI par Vitest). Checklist manuelle via `pnpm dev` avant de considérer le travail terminé :

1. Se connecter avec un compte non-admin, ouvrir `/admin/profiles` → redirection immédiate vers `/`.
2. Se connecter avec un compte `ADMIN`, ouvrir `/admin/profiles` → liste `PUBLISHED` par défaut.
3. Basculer le filtre vers `SUSPENDED` puis `DRAFT` → la liste se recharge correctement pour chaque statut.
4. Suspendre un profil `PUBLISHED` avec une raison → badge de statut mis à jour, le profil apparaît dans le filtre `SUSPENDED`, une entrée `AdminAction` (`profile.suspend`) est créée avec la raison en métadonnées.
5. Republier ce même profil → badge mis à jour, réapparaît dans `PUBLISHED`, entrée `AdminAction` (`profile.publish`) créée.
6. Tenter de suspendre sans saisir de raison → erreur de validation inline affichée, aucune requête réseau envoyée.
7. Avec un jeu de données de plus de 50 profils dans un même statut, vérifier la pagination "Charger plus".

## Hors scope (cette passe)

- Bootstrap du back-office complet (`/admin/users`, `/admin/orders`, `/admin/withdrawals`, `/admin/audit-log`) et son layout/nav partagé.
- Vue détail d'un profil (pitch d'idée, lien externe) côté admin.
- Recherche plein-texte ou tri autre que `createdAt desc` (hérité du endpoint existant).
- Modification du contrat `can` de `/api/admin/me` (`D-ADMIN-04`, verrouillé).
