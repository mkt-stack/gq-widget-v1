# GQ Widgets (`gq-widget-v1`)

A custom Shopify app for gqsize.com that holds GQ's own checkout and customer-account widgets. Each widget is set up from one admin page inside the app. Settings go live on save, with no redeploy.

**Stack:** React Router 7 app template · Polaris web components (admin and extensions) · Preact checkout/customer-account UI extensions · API version **2026-07** · Prisma (sessions only).

## Widgets

| Widget | Surface | Extension | Admin page |
|---|---|---|---|
| Checkout countdown | Checkout (all steps, Plus) | `extensions/checkout-countdown` | `/app/widgets/countdown` |
| Delivery estimate | Checkout, under shipping options (Plus) | `extensions/checkout-delivery-estimate` | `/app/widgets/delivery` |

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

### Delivery estimate

Shows something like **"Estimated delivery Thu 4th - Fri 5th Oct"** (Thai: "คาดว่าจะได้รับสินค้า พฤ. 4 - ศ. 5 ต.ค.").

- **Rules:** up to 5, each with its own delivery window (min and max working days), an optional message override (plus EN), and display conditions.
- **Ranking:** rules are checked top to bottom and the **first match wins**. If a higher rule is still waiting on product or customer facts, the widget waits instead of briefly showing a lower rule.
- **Default estimate:** used when no rule matches. Turn it off to show nothing in that case.
- **Dates:**
  - Days are working days, counted from the processing day. That is today if it's before the cutoff hour (shop time zone, default Asia/Bangkok, 14:00); otherwise it's the next working day.
  - Non-working weekdays and listed holidays are skipped.
  - English uses ordinals ("Thu 4th"); other languages use the browser's short weekday and month names.
- **Shipping-method condition:** matches when the selected shipping rate's name contains a value, e.g. "VIP". The countdown can use it too.
- **Pickup:** the widget hides itself when the buyer chooses pickup.
- **Placement:** two targets:
  - `purchase.checkout.shipping-option-list.render-after`, directly under the shipping options (recommended)
  - `purchase.checkout.block.render`, anywhere

  Add only one.

## Architecture

```
app/                         Admin app (embedded in Shopify admin)
  routes/app._index.tsx        Widget dashboard (status, app-URL resync)
  routes/app.widgets.*.tsx     One settings page per widget
  routes/api.storefront.*.tsx  Endpoints called by extensions (session-token auth + CORS)
  widgets/registry.ts          List of widgets → dashboard
  widgets/metafields.server.ts Read/write widget config metafields
  components/                  Shared admin UI (ConditionBuilder, previews)
packages/widget-core/        Shared TS: config types, defaults, normalizers, condition engine,
                             delivery-date maths. No dependencies. Used by the admin and extensions.
packages/checkout-kit/       Preact hooks shared by checkout extensions: config from app metafields,
                             condition facts (Storefront API + customer-facts endpoint).
extensions/<widget>/         One UI extension per widget (Preact + Polaris web components)
```

**How config flows:** the admin page saves a JSON config to an **app-owned shop metafield** (`$app` namespace, key `widget_<id>`). Each extension declares that metafield in `shopify.extension.toml` and reads it through `shopify.appMetafields`. The storefront never calls our server just to render a widget.

**Checking conditions in checkout:**

| Condition | Data source | Cost |
|---|---|---|
| Products, subtotal, quantity | Live checkout APIs | Free |
| Product tags, collections | Storefront API (`api_access`) | Fetched only when the rules need it |
| Customer tags, logged-in status | `POST /api/storefront/customer-facts` | Fetched only when the rules need it |
| Selected shipping method | Live checkout API (`deliveryGroups`) | Free |

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

### Hosting (Railway)

Production runs on Railway: project **modest-ambition** → service **gq-widget-v1**, under the mkt@suparagroup.com account. It is built from this repo's `Dockerfile` on every push to `main`.

- **URL:** https://gq-widget-v1-production.up.railway.app. This matches `application_url` in `shopify.app.toml`.
- **Service variables:**
  - `SHOPIFY_API_KEY`: the app's client ID
  - `SHOPIFY_API_SECRET`
  - `SHOPIFY_APP_URL`: the URL above
  - `SCOPES`: same as the toml
  - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}`
- **Database:** Prisma uses the project's Postgres, which only stores sessions. Migrations run at startup (`npm run docker-start`).
- **If the URL changes:**
  1. Update `SHOPIFY_APP_URL`, plus `application_url` and `redirect_urls` in the toml.
  2. Run `npm run deploy`.
  3. Click **Update widgets** on the app dashboard.

### Local development

`npm run dev` needs a Postgres `DATABASE_URL` in `.env` (gitignored). Use a local Postgres, or a separate Railway database. Don't use production's, because `dev` would write its sessions there.

`automatically_update_urls_on_dev` is `false` on purpose. Dev uses the same app, and leaving it on would replace the production URL with the tunnel URL.

## Adding a widget

1. **Core:** add `packages/widget-core/src/<widget>.ts` with the config type, defaults, `normalize…()` and the metafield key, then export it from `index.ts`.
2. **Extension:** run `npm run generate -- extension` (choose *Checkout UI* or *Customer account UI*, Preact). Then:
   - set `api_version = "2026-07"`
   - declare `[[extensions.metafields]] namespace = "$app" key = "widget_<id>"`
   - add `"@gq/widget-core": "*"` and `"@gq/checkout-kit": "*"` to its `package.json`
   - use `useWidgetConfig` and `useConditionContext` from `@gq/checkout-kit` instead of re-implementing them
   - add it to the `typecheck:extensions` script
3. **Admin page:** add `app/routes/app.widgets.<id>.tsx`, reusing `ConditionBuilder` and `readWidgetConfigs` / `writeWidgetConfig`.
4. **Registry:** add an entry in `app/widgets/registry.ts` and a nav link in `app/routes/app.tsx`.

**Checkout limits to design for:**
- Extensions are capped at 64 KB compiled. The countdown and the delivery estimate are each about 33 KB.
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
