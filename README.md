# GQ Widgets (`gq-widget-v1`)

A custom Shopify app for gqsize.com that holds GQ's own checkout and customer-account widgets. Each widget is set up from one admin page inside the app. Settings go live on save, with no redeploy.

**Stack:** React Router 7 app template · Polaris web components (admin and extensions) · Preact checkout/customer-account UI extensions · API version **2026-07** · Prisma (sessions only).

## Widgets

| Widget | Surface | Extension | Admin page |
|---|---|---|---|
| Checkout countdown | Checkout (all steps, Plus) | `extensions/checkout-countdown` | `/app/widgets/countdown` |

### Checkout countdown

- **Start:** the timer starts the first time the block renders in a checkout. It is stored in `shopify.storage`, so it survives reloads and step changes, and a new checkout starts a fresh timer.
- **Settings (admin):**
  - duration
  - warning threshold
  - countdown, warning and expired messages (`{time}` marks where the clock goes), with optional English overrides
  - what happens on expiry: show the message, hide, or restart
  - appearance: compact or banner
- **Display conditions:** match **all** or **any** of these:
  - cart contains products, product tags, or a product from a collection (any / none)
  - cart subtotal or item quantity (≥ / ≤)
  - customer tags (any / none)
  - customer is logged in or a guest
- **Placement:** two targets share one timer:
  - `purchase.checkout.block.render`, which you can place anywhere in the checkout editor
  - `purchase.checkout.header.render-after`, a fixed spot under the header

  Add only one of them, or buyers will see two timers.

## Architecture

```
app/                         Admin app (embedded in Shopify admin)
  routes/app._index.tsx        Widget dashboard (status, app-URL resync)
  routes/app.widgets.*.tsx     One settings page per widget
  routes/api.storefront.*.tsx  Endpoints called by extensions (session-token auth + CORS)
  widgets/registry.ts          List of widgets → dashboard
  widgets/metafields.server.ts Read/write widget config metafields
  components/                  Shared admin UI (ConditionBuilder, previews)
packages/widget-core/        Shared TS: config types, defaults, normalizers, condition engine.
                             No dependencies. Used by both the admin and the extensions.
extensions/<widget>/         One UI extension per widget (Preact + Polaris web components)
```

**How config flows:** the admin page saves a JSON config to an **app-owned shop metafield** (`$app` namespace, key `widget_<id>`). Each extension declares that metafield in `shopify.extension.toml` and reads it through `shopify.appMetafields`. The storefront never calls our server just to render a widget.

**Checking conditions in checkout:**

| Condition | Data source | Cost |
|---|---|---|
| Products, subtotal, quantity | Live checkout APIs | Free |
| Product tags, collections | Storefront API (`api_access`) | Fetched only when the rules need it |
| Customer tags, logged-in status | `POST /api/storefront/customer-facts` | Fetched only when the rules need it |

Customer tags aren't exposed to checkout, so the endpoint does this lookup. It verifies the checkout session token, takes the customer ID from the token's `sub` claim, and returns only which of the *requested* tags the customer has. If the lookup fails, the buyer is treated as a guest.

The condition engine short-circuits: an `any` rule set can pass, and an `all` rule set can fail, on cheap data before the expensive lookups come back.

## First-time setup

1. `npm install`
2. `npm run config:link`. This creates the app in the Shopify Dev Dashboard (or links an existing one) and fills in `client_id` and the URLs in `shopify.app.toml`.
3. In the Dev Dashboard, under **API access**:
   - **Allow network access in checkout UI extensions.** Customer-tag conditions need this.
   - **Protected customer data → request access to Customer data (name/email not required).** This is needed for `read_customers` and for the customer ID in the session token.
4. `npm run dev`. Install on the dev store, open the app, configure and save the countdown, then add the **GQ Checkout Countdown** block in *Settings → Checkout → Customize*.
5. `npm run deploy` to release the extension and app config.

The `shopify` CLI in `devDependencies` (4.x) is the one `npm run dev` uses. Your global CLI is 3.93 and is not needed.

### Hosting

The app server must be reachable over HTTPS, because checkout calls it for customer conditions. `SHOPIFY_APP_URL` is written into each widget config on save. If the URL changes (a new dev tunnel, or a production domain), the dashboard shows an **App URL changed → Update widgets** banner. A `Dockerfile` is included (same pattern as gq-member-club). Set `DATABASE_URL`/the Prisma provider for production; SQLite is the dev default.

## Adding a widget

1. **Core:** add `packages/widget-core/src/<widget>.ts` with the config type, defaults, `normalize…()` and the metafield key, then export it from `index.ts`.
2. **Extension:** run `npm run generate -- extension` (choose *Checkout UI* or *Customer account UI*, Preact). Then:
   - set `api_version = "2026-07"`
   - declare `[[extensions.metafields]] namespace = "$app" key = "widget_<id>"`
   - add `"@gq/widget-core": "*"` to its `package.json`
3. **Admin page:** add `app/routes/app.widgets.<id>.tsx`, reusing `ConditionBuilder` and `readWidgetConfigs` / `writeWidgetConfig`.
4. **Registry:** add an entry in `app/widgets/registry.ts` and a nav link in `app/routes/app.tsx`.

**Checkout limits to design for:**
- Extensions are capped at 64 KB compiled. The countdown is about 30 KB.
- No DOM access and no custom CSS. Only Polaris `s-*` components, which take the store's checkout branding.
- Customer data needs protected-customer-data approval.
- Any `fetch` needs `network_access` and must answer CORS (use `authenticate.public.checkout` / `authenticate.public.customerAccount`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Shopify CLI dev (tunnel, app and extension hot reload) |
| `npm run typecheck` | App and extension TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests for `widget-core` |
| `npm run build` | Production build of the admin app |
| `npm run deploy` | Release extensions and app config |
