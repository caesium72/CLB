import type { MetadataRoute } from "next";

/**
 * Allow crawling so social-share crawlers (facebookexternalhit, Twitterbot, etc.)
 * can read the Open Graph tags for link previews. Staying out of search results is
 * handled by the `noindex` robots meta tag (see app/layout.tsx) — a robots.txt
 * `Disallow: /` would block the OG fetch AND stop Google from ever seeing the
 * noindex tag, so it is intentionally NOT used here.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
  };
}
