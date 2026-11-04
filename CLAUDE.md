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
- `node scripts/fetchPrices.mjs --city חיפה --max-branches 3 --products "חלב,עגבניה,ביצים L" --out scripts/out`
  — local probe of the price fetcher (zero deps, Node ≥20; ~1 min for 2 branches × 13
  chains). `--chains shufersal,RamiLevi` limits portals. In CI it runs with
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
- **Government price-transparency portals → prices** (clean XML, one standard schema).
  **Shufersal** (branches from the store dropdown; PriceFull off `FileObject/UpdateCategory`;
  label has a `"<id> - "` prefix, stripped), **Cerberus** (`url.publishedprices.co.il`,
  law-mandated password-less public logins per chain in `CERBERUS_CHAINS`: Rami Levy, Osher
  Ad, Yohananof, Tiv Taam, Fresh Market, Dor Alon, Keshet, Salach Dabach, Politzer, Stop
  Market), **Carrefour** (`prices.carrefour.co.il` embeds `const files=[…]`/`const path`;
  files at `/<path>/<name>`) and **Hazi Hinam** (`shop.hazi-hinam.co.il/Prices?p=N`,
  paginated absolute blob links; `t=Stores` for the Stores file). Cerberus gotchas handled:
  the login **rotates the CSRF token** (re-read from `/file` after login), store files are
  **UTF-16**, branch id is the third dash-segment of `PriceFull` filenames. Dead/unusable:
  Victory group (`laibcatalog.co.il`, ASP.NET UpdatePanel, never returned rows),
  binaprojects (King Store etc.) and `matrixcatalog` domains no longer resolve.
- **City matching** (`cityMatcher`): many chains put the **CBS settlement code** in
  `<City>` (חיפה = 4000) instead of a name, so a branch matches by code
  (`scripts/cityCodes.json`, generated once from data.gov.il) OR by name substring over
  city+address+store name, with "קריית"→"קרית" folded.
- **Weighed goods have no national barcode.** Produce/deli carry a different internal
  code per chain, so they are matched **by name** inside each branch file among
  `bIsWeighted=1` items (`parseWeighted`/`matchWeighed`: same normalized name → same
  canonical product → product + further plain qualifier; qualifiers that change the
  product ("אורגני", "ציפס", "שרי"…) are blocked). `normalizeName` folds finals and
  "יי"→"י"; `canonicalWeighed` = stemmed words minus `NEUTRAL_STEMS` (ארוז, תפזורת,
  יומי, ישראל, חממה…), so "עגבניה"/"עגבנייה"/"עגבניה יומי"/"עגבניות ישראל" are one
  product — the catalog has one row per canonical product. Price is **per kg**
  (`unit:'kg'`). An unpinned name is weighed when chp's top hit says "מחיר לפי משקל",
  when chp knows nothing (then only a near-exact weighed name counts), or — for a name chp
  resolved to a packaged barcode — when EXACT (not stem) weighed name matches cover at
  least half as many branch files as the barcode does ("מלפפון" beats chp's pickles; one
  chain's deli "שמנת חמוצה" does not hijack the packaged one; stems are too loose — "חלב"
  stems like "חלבה").
- **Product catalog** (`catalog.json`, same branch files, ≤6 files per chain, ~60k rows
  `[name, chainMask, barcodes?]` where barcodes is a string or, for one product sold under
  several store-brand codes with the same name, an array; none = weighed): the app's add
  bar offers concrete products from it (`lib/catalog.ts` `searchCatalog`, lazy-loaded by
  `useCatalog` on first focus, cached by the SW `price-data` rule). **One row per
  product, never per chain** — the user asked explicitly not to see "the same product
  several times pinned to different chains". Picking one **pins** the nameKey
  (`pins[k] = {kind:'barcode', code, codes?, name} | {kind:'weighed', name}`; legacy
  bare-string pins = barcode) via `usePrices.pinProduct`; with `codes` the job prices
  whichever code each branch stocks (cheapest) and records it in `codeByStore` so the
  in-store view shows the right barcode.
- `.github/workflows/prices.yml` runs nightly: reads `config/trackedProducts` (the public
  Firestore doc) via unauthenticated REST, resolves barcodes ONCE (a barcode is national),
  fetches portal prices **per tracked city**, and force-pushes `prices.json`, `catalog.json`
  and `branches.json` to the orphan `data` branch using the built-in `github.token` — **no
  service-account key, no secret**. Shape: `{updatedAt, cities:[...], byCity:{<city>:{city,
  stores:[{key,chain,name,address}], items:[{k(nameKey), n, kind, barcode, codes?,
  codeByStore?, product, unit?, pinned, byStore:{storeKey:price}, candidates}]}}, ...}` plus a
  top-level single-city mirror
  (`city/stores/items` = first city) for older app builds. Keyed by **nameKey** so the app
  crosses its list items directly. `nameKeyOf` is duplicated in the script — keep it in sync
  with `lib/categories.ts`.
- `config/trackedProducts` is the one publicly-readable Firestore doc (rules: `read: if
  true`, `write: if allowed()`): `{products:[{k,n}], pins:{nameKey:ProductLink}, cities:[...]}`.
  `usePrices` merge-writes `products` (the current list, debounced), `pins` (user picks)
  and `cities` (arrayUnion/Remove) as **separate fields** so changing one never clobbers the
  others. Seeded with `cities:["חיפה"]`; a new city takes effect on the next run.
- **App side** (`lib/prices.ts`: `fetchPriceData`, `availableCities`, `cityData` → a
  per-city `PriceSlice`, `rankBasket(active, slice)` — pure, **coverage first then price**,
  qty leading-integer as multiplier). `usePrices` owns the snapshot fetch (raw.githubusercontent,
  CORS `*`, 5-min cache), the tracked-list sync, the selected city (localStorage `priceCity`),
  and `addCity`. `PriceCheckSheet` (💰 header button): city switcher, ranking, and per-store
  **"אני בסופר"** → an in-aisle list with each product's price + scannable **EAN-13 barcode**
  (`Barcode.tsx`). City picker list is `lib/cities.ts`.
- Not built yet: re-pinning an item that is already on the list (pins happen only when
  picking a catalog row in the add bar; `candidates` exist but no picker in the sheet),
  camera barcode scan, per-store totals inline on the main list, Victory group prices.

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
