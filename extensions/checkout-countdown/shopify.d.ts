import '@shopify/ui-extensions';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
declare module './src/Checkout.tsx' {
  const shopify:
    | import('@shopify/ui-extensions/purchase.checkout.block.render').Api
    | import('@shopify/ui-extensions/purchase.checkout.header.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}
