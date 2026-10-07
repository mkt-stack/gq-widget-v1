# GQ Widgets — agent notes

Custom Shopify app for **gqsize.com** (Shopify Plus, THB, Thai-first). It hosts GQ's checkout and customer-account widgets, each configured from the embedded admin. See README.md for architecture.

## Rules
- **API version 2026-07** for every extension and webhook. Admin API: `ApiVersion.July26`.
- Extensions: Preact + Polaris web components (`s-*`) only; no React, no DOM, and the bundle must stay ≤ 64 KB. Validate extension code with the Shopify AI Toolkit `shopify-polaris-checkout-extensions` / `shopify-polaris-customer-account-extensions` skills.
- Widget config is a JSON **app-owned shop metafield** (`$app`, key `widget_<id>`). Always pass it through the widget's `normalize…Config()` from `@gq/widget-core`, whether reading or writing. Never trust raw metafield JSON.
- `packages/widget-core` must stay dependency-free and browser/worker-safe, because it ships inside checkout bundles.
- Endpoints that extensions call live under `app/routes/api.storefront.*`. They must use `authenticate.public.checkout` (or `.customerAccount`), return through `cors()`, and identify customers only from the session token `sub`.
- Default customer-facing copy is Thai, with English in `translations.en`.

## Checks before finishing
`npm run typecheck && npm run lint && npm test && npm run build`

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for Shopify API and platform work.
