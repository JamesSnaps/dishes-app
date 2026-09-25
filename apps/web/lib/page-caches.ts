/**
 * The service worker's stale-while-revalidate caches for page documents and RSC
 * payloads (`app/sw.ts`). Shared with the page so it can empty them when the
 * Authelia session expires — see `reloadToSignIn` in the sync provider.
 *
 * No imports: this is bundled into the service worker as well as the app.
 */
export const PAGE_CACHES = {
  html: "pages",
  rsc: "pages-rsc",
} as const;
