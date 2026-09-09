import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { db } from '@/lib/db'
import { absoluteUrl } from '@/lib/routes'
import { looksLikeId } from '@/lib/slug'
import { categoryLabel, formatEventDate, formatTime } from '@/lib/format'
import { EventDetail } from '@/components/customer/event-detail'

/** Statuses that are visible to the public — mirrors GET /api/events/[id]. */
const PUBLIC_STATUSES = ['PUBLISHED', 'ONGOING']

/**
 * Resolves the URL segment to an event. Accepts a slug or an id so links made
 * before slugs existed still work; the page then redirects an id to the
 * canonical slug URL.
 */
async function findEvent(segment: string) {
  const decoded = decodeURIComponent(segment)
  return db.event.findFirst({
    where: looksLikeId(decoded) ? { OR: [{ slug: decoded }, { id: decoded }] } : { slug: decoded },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      banner: true,
      category: true,
      status: true,
      startDate: true,
      endDate: true,
      startTime: true,
      venue: true,
      address: true,
      city: true,
      organizer: { select: { organizationName: true } },
      ticketTypes: { select: { price: true, totalQuantity: true, soldQuantity: true } },
    },
  })
}

/** First paragraph, trimmed to something a search result or OG card can hold. */
function summarise(description: string, max = 200): string {
  const firstPara = description.split('\n').map((p) => p.trim()).find(Boolean) ?? ''
  if (firstPara.length <= max) return firstPara
  return `${firstPara.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const event = await findEvent(slug)

  if (!event || !PUBLIC_STATUSES.includes(event.status)) {
    return { title: 'Event not found', robots: { index: false, follow: false } }
  }

  const canonical = `/events/${event.slug ?? event.id}`
  const description = summarise(event.description)
  const when = `${formatEventDate(event.startDate)} · ${formatTime(event.startTime)}`
  const title = event.title

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title: `${title} · TicketBD`,
      description: `${when} — ${event.venue}, ${event.city}. ${description}`,
      url: canonical,
      // Relative paths resolve against metadataBase; an absolute banner URL is
      // passed through untouched.
      images: event.banner ? [{ url: event.banner, alt: `${title} banner` }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · TicketBD`,
      description: `${when} — ${event.venue}, ${event.city}`,
      images: event.banner ? [event.banner] : undefined,
    },
  }
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const event = await findEvent(slug)

  // Unlisted statuses (draft, pending, suspended) stay reachable for the owning
  // organizer and admins, but only through the client fetch, which re-checks
  // the session. A public crawler gets a 404 here either way.
  if (!event) notFound()

  const canonicalSegment = event.slug ?? event.id
  if (decodeURIComponent(slug) !== canonicalSegment) {
    permanentRedirect(`/events/${canonicalSegment}`)
  }

  const isPublic = PUBLIC_STATUSES.includes(event.status)
  const prices = event.ticketTypes.map((t) => t.price)
  const remaining = event.ticketTypes.reduce(
    (sum, t) => sum + Math.max(0, t.totalQuantity - t.soldQuantity),
    0,
  )

  /**
   * schema.org Event, so search engines and social platforms can render a rich
   * result. Only emitted for publicly visible events.
   */
  const jsonLd = isPublic
    ? {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: event.title,
        description: summarise(event.description, 500),
        url: absoluteUrl(`/events/${canonicalSegment}`),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        ...(event.banner ? { image: [absoluteUrl(event.banner)] } : {}),
        location: {
          '@type': 'Place',
          name: event.venue,
          address: {
            '@type': 'PostalAddress',
            streetAddress: event.address,
            addressLocality: event.city,
            addressCountry: 'BD',
          },
        },
        organizer: {
          '@type': 'Organization',
          name: event.organizer.organizationName,
        },
        about: categoryLabel(event.category),
        ...(prices.length > 0
          ? {
              offers: {
                '@type': 'AggregateOffer',
                priceCurrency: 'BDT',
                lowPrice: Math.min(...prices),
                highPrice: Math.max(...prices),
                offerCount: event.ticketTypes.length,
                availability:
                  remaining > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
                url: absoluteUrl(`/events/${canonicalSegment}`),
              },
            }
          : {}),
      }
    : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // Server-rendered from our own database, not user input in the HTML sense.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      <EventDetail eventId={event.id} />
    </>
  )
}
