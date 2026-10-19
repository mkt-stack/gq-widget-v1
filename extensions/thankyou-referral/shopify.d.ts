import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/ThankYou.tsx' {
  const shopify:
    | import('@shopify/ui-extensions/purchase.thank-you.block.render').Api
    | import('@shopify/ui-extensions/purchase.thank-you.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}
