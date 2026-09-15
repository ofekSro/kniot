# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"רשימת קניות" — a Hebrew, RTL, mobile-first PWA shared grocery list for exactly two
whitelisted Google accounts. Live at https://kniot-1299d.web.app (Firebase project
`kniot-1299d`). The users communicate in Hebrew; all UI copy is Hebrew.

Git repo: `github.com/ofekSro/kniot` (public), `main` is deployed. A separate
orphan `data` branch is machine-written by the price Action (see below) — never merge
it. The working directory lives inside OneDrive ("OneDrive - Technion"): sync can
transiently lock files (node_modules, dev-server output), so a mysterious EPERM/EBUSY is
usually sync, not code. `gh` is not on PATH; auth here has used the GitHub device flow
(client id `178c6fc778ccc68e1d6a`, scopes `repo,workflow`) with a portable `gh` binary
or a token in a one-shot push URL — never persist a token in git config or a committed
file.

Stack is deliberately fixed: React 18 + Vite 7 + TypeScript (strict) + Tailwind v4
(CSS-first, no tailwind.config) + Firebase (Google Auth, Firestore with persistent
multi-tab cache, Hosting) + vite-plugin-pwa. No router, no state library, no test
framework, no server code. React 18 is why `@vitejs/plugin-react` is pinned to 4.x and
Vite to 7 — plugin-react 6 requires Vite 8; don't "upgrade" these.

## Commands

- `npm run dev` / `npm run build` — build runs `tsc -b && vite build`; **zero TS errors
  is the gate after every change**.
- `npm run seed` — writes `config/allowedUsers` from `ALLOWED_EMAILS` in `.env` via
  firebase-admin (needs `service-account.json`). Seeding must bypass rules — clients can
  never create that doc.
- `npm run icons` — regenerates PWA icons from the inline SVG in `scripts/generateIcons.mjs`.
- `node scripts/fetchPrices.mjs --city חיפה --max-branches 3 --products "חלב,לחם אחיד,ביצים L" --out scripts/out`
  — local probe of the price fetcher (zero deps, Node ≥20). In CI it runs with
  `--tracked-url <public trackedProducts REST url>` instead of `--products`.
- Deploy: `npx firebase-tools@15 deploy` (or `--only hosting`, `--only firestore:rules`,
  `--only auth`). The CLI is logged in on this machine; `.firebaserc` targets `kniot-1299d`.
- No test framework by design. Verification convention used throughout: temporary
  `src/__*.tsx` harness + `uipreview.html` (a sed-copy of index.html pointing at the
  harness), screenshotted with Playwright installed in the session scratchpad, then
  deleted. Logic checks are throwaway `npx tsx src/__*.ts` scripts, also deleted.

## Access model (the part that's easy to break)

- `firestore.rules` gates every collection on `allowed()`: the caller's verified email
  must be in `config/allowedUsers.emails` (a rules-time `get()`). `config/allowedUsers`
  is readable only by allowed users and writable by no one — seeded out-of-band.
- The client never receives the email list. `useAuth` decides access by *attempting* to
  read `config/allowedUsers`: success → ready; `permission-denied` → NoAccess screen; any
  other error (offline cold cache) → optimistic ready so the cached list still works.
- `ALLOWED_EMAILS` and `GOOGLE_APPLICATION_CREDENTIALS` in `.env` are deliberately NOT
  `VITE_`-prefixed so they can never reach the bundle. `.env` holds real values locally
  and is gitignored.
- `config/settings` (shared list title, synced by `useAppTitle`) is the one config doc
  allowed users may write. Any new shared setting belongs there + a rules entry.

## Architecture

- **Hooks own all Firestore I/O** (`src/hooks/`): `useItems` (CRUD + `finishShopping`,
  a chunked `writeBatch` ≤200 items that upserts `history/{nameKey}` with
  `increment(1)` then deletes each item), `useHistory`, `useFavorites`, `useAuth`
  (generation-token guard against a slow whitelist check resurrecting a signed-out
  user), `useAppTitle`. Components are presentational; `ListScreen` composes everything
  and owns sheet/dialog state.
- **Timestamps are `Timestamp.now()`, never `serverTimestamp()`** — server timestamps
  read back `null` locally until ack, which reorders rows while offline (the core use
  case). Consequence: all sorting is client-side and no composite indexes exist.
- **`nameKeyOf` (lib/categories.ts)** is the canonical key: doc id for
  history/favorites and duplicate detection. It strips `/` (Firestore path separator).
  Adding an unbought item whose key already exists flashes the existing row instead.
- **Category guesser** (`lib/categories.ts`): keywords are matched per-word by prefix
  after normalization that folds Hebrew final letters (ן→נ etc.); multi-word stems match
  the whole name. Longest match wins across categories, but a match on an earlier word
  wins outright (Hebrew construct phrases put the head noun first: "חלב שיבולת שועל" is
  dairy). History overrides the guesser from the second purchase on — so bad stored
  categories self-perpetuate; fix data too when fixing keywords.
- **Stores** (`lib/stores.ts`): every item has a `store` (`super`/`stock`/`hishuk`),
  defaulted by `storeForCategory` (cleaning+toiletries→stock, pantry→hishuk, else
  super), overridable in EditSheet, remembered in history. Old docs without the field
  are derived at read time — no migrations. The "לפי חנות" toggle renders
  `StoreSection`s; "סיימתי קנייה" is store-agnostic on purpose (clears checked only).
- **Skin/theme system** (`src/index.css`): every color in components is a semantic
  token utility (`bg-app-bg`, `bg-card`, `bg-field`, `border-edge`, `bg-track`,
  `bg-band`, `text-ink`/`-muted`/`-faint`, `bg-accent`, `text-on-accent`,
  `bg-accent-soft`, `text-accent-ink`, `font-display`) mapped via `@theme inline` to
  `--sk-*` variables. Four skins (`classic`, `market`, `night`, `colorful`) × light/dark
  each define the full set. **Never use raw palette classes (stone-*/green-*) in
  components** — only red/amber literals for danger/offline states are exempt.
  Per-category color comes from one hue number (`CATEGORY_HUES`) set as `--cat-hue`
  inline; CSS derives tints/bars via `oklch()` for the skins that use them
  (`.cat-card`/`.cat-title` hooks).
- **Per-device vs shared state**: localStorage holds view preferences (`theme`, `skin`,
  `splitByStore`) — applied pre-paint by the inline script in `index.html` (update it
  when adding such state). Firestore holds everything shared.
- **RTL only**: logical properties/classes exclusively (`ps-`/`pe-`/`ms-`/`me-`,
  `text-start`, `border-inline-start`). Touch targets ≥44px (`min-h-11`+).
  `Sheet.tsx` is the shared bottom-sheet shell for all sheets.

## Price pipeline ("איפה הכי זול" — the 💰 button)

Goal: rank Haifa supermarket branches by the couple's actual basket, to save money.
Deliberately **serverless and credential-free**. Two data sources, each used for what
it does *cleanly* (`scripts/fetchPrices.mjs`):

- **chp.co.il autocomplete → barcode.** The couple's items are generic ("חלב"), so each
  is resolved to a concrete product barcode via `/autocompletion/product_extended` (clean
  JSON, top hit unless a barcode is pinned). **Do NOT use chp's `compare_results` page for
  prices**: after the first request per IP it CSS-obfuscates the results — text split
  across spans/divs with decoy digits/letters + zero-width chars — which corrupts even the
  prices and needs its randomized per-response CSS to undo. Autocomplete is not obfuscated.
- **Government price-transparency portals → prices** (clean XML). **Shufersal** (public;
  branches from the store dropdown; PriceFull off `FileObject/UpdateCategory`; store name
  label has a `"<id> - "` prefix, stripped) and **Cerberus** (`url.publishedprices.co.il`,
  law-mandated public logins per chain in `CERBERUS_CHAINS`). Cerberus gotchas handled: the
  login **rotates the CSRF token** (re-read from `/file` after login), store files are
  **UTF-16**, branch id is the third dash-segment of `PriceFull` filenames. Haifa: Shufersal
  + Rami Levy + Osher Ad return data; yohananof/TivTaam have no Haifa branch.
- `.github/workflows/prices.yml` runs nightly: reads `config/trackedProducts` (the public
  Firestore doc) via unauthenticated REST, resolves barcodes, fetches portal prices, and
  force-pushes a compact `prices.json` to the orphan `data` branch using the built-in
  `github.token` — **no service-account key, no secret**. Shape: `{city, updatedAt,
  stores:[{key,chain,name,address}], items:[{k(nameKey), n, barcode, product, byStore:{
  storeKey:price}, candidates}]}`. Keyed by **nameKey** so the app crosses its list items
  against it directly. `nameKeyOf` is duplicated in the script — keep it in sync with
  `lib/categories.ts`.
- `config/trackedProducts` is the one publicly-readable Firestore doc (rules: `read: if
  true`, `write: if allowed()`): `{products:[{k,n}], pins:{nameKey:barcode}}`. `usePrices`
  merge-writes `products` (the current list, debounced) and `pins` (user overrides) as
  **separate fields** so a list change never clobbers pins.
- **App side** (all built): `usePrices` (fetches `prices.json` from raw.githubusercontent —
  CORS `*`, 5-min cache; syncs trackedProducts; `pinProduct`), `rankBasket` in `lib/prices.ts`
  (pure; **coverage first, then price** — a branch missing basket items shows a low total but
  isn't cheaper; a leading integer in an item's qty is a multiplier), and `PriceCheckSheet`
  (the 💰 header button). New items are priced only after the next nightly run.
- Not built yet: pinning a specific product from the UI (`pinProduct`/`candidates` exist,
  no picker), camera barcode scan, per-store totals shown inline on the list.

## Firebase config gotchas

- `firebase.json` has an `auth` section — `deploy --only auth` enables the Google
  provider and auto-creates the OAuth client. Do NOT add an `authorizedRedirectUris`
  entry for `/__/auth/handler`; the CLI adds it itself and a duplicate fails the deploy.
- `sw.js`, `index.html`, and the manifest are served `no-cache` (firebase.json headers)
  so the autoUpdate service worker can actually update; keep that when touching hosting
  config. The Firebase SDK is split into its own chunk (`manualChunks`) — app code
  updates shouldn't re-download it.
- `README.md` is the Hebrew, user-facing setup/ops doc — keep it Hebrew and in sync
  when setup flows change.
