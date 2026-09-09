import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'
import { siteUrl } from '@/lib/routes'

/** Regenerate at most hourly; event listings do not change faster than that. */
export const revalidate = 3600

/**
 * Only publicly reachable URLs belong here: the marketing pages and every
 * event that is on sale. Signed-in routes are excluded (and carry
 * `robots: noindex` of their own).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/events`, changeFrequency: 'daily', priority: 0.9 },
  ]

  try {
    const events = await db.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'ONGOING'] },
        // Matches the public listing: an event that has finished is not a
        // destination we want crawled as if it were on sale.
        endDate: { gte: new Date() },
      },
      select: { id: true, slug: true, updatedAt: true },
      orderBy: { startDate: 'asc' },
      take: 5000,
    })

    return [
      ...staticEntries,
      ...events.map((e) => ({
        url: `${base}/events/${e.slug ?? e.id}`,
        lastModified: e.updatedAt,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ]
  } catch (err) {
    // A database hiccup should degrade the sitemap, not break the route.
    console.error('sitemap: failed to list events:', err instanceof Error ? err.message : err)
    return staticEntries
  }
}
