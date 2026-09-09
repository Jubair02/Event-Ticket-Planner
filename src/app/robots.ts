import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/routes'

/**
 * Replaces the previous static `public/robots.txt`, which could not reference
 * the sitemap or the absolute host. The named crawler groups are carried over
 * from that file: the social unfurlers are allowed everywhere because they only
 * fetch URLs a person has already shared, and blocking them breaks link
 * previews for event pages.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl()

  /** Signed-in surfaces. Each also sends `noindex`; this saves crawl budget. */
  const privatePaths = [
    '/api/',
    '/checkout/',
    '/order/',
    '/tickets',
    '/organizer',
    '/admin',
    '/staff',
  ]

  return {
    rules: [
      { userAgent: 'Googlebot', allow: '/', disallow: privatePaths },
      { userAgent: 'Bingbot', allow: '/', disallow: privatePaths },
      // Link-preview bots: full access, so shared event URLs unfurl correctly.
      { userAgent: 'Twitterbot', allow: '/' },
      { userAgent: 'facebookexternalhit', allow: '/' },
      { userAgent: '*', allow: '/', disallow: privatePaths },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
