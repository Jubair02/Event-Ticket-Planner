import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { CATEGORIES } from '@/lib/constants'
import { safeHttpUrl } from '@/lib/url'
import { uniqueEventSlug } from '@/lib/slug'
import { MAX_TICKET_PRICE_MINOR, isMinor } from '@/lib/money'
import { jsonSafe } from '@/lib/serialize'

type TicketTypeInput = {
  name?: unknown
  description?: unknown
  priceMinor?: unknown
  totalQuantity?: unknown
  maxPerOrder?: unknown
  salesStart?: unknown
  salesEnd?: unknown
}

type TicketTypeSeed = {
  name: string
  description: string | null
  priceMinor: number
  totalQuantity: number
  maxPerOrder: number
  salesStart: Date | null
  salesEnd: Date | null
}

function parseDate(v: unknown): Date | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? 'invalid' : d
}

/** Validates + normalizes the ticketTypes array. Returns error string or data. */
function normalizeTicketTypes(raw: unknown): { error?: string; data?: TicketTypeSeed[] } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'At least one ticket type is required' }
  }
  const data: TicketTypeSeed[] = []
  for (const t of raw as TicketTypeInput[]) {
    const name = typeof t?.name === 'string' ? t.name.trim() : ''
    // Paisa on the wire; the form parses the typed decimal with `toMinor`.
    const priceMinor = Number(t?.priceMinor)
    const totalQuantity = Number(t?.totalQuantity)
    if (!name) return { error: 'Every ticket type needs a name' }
    if (!isMinor(priceMinor) || priceMinor <= 0) {
      return { error: `Ticket type "${name}" must have a price greater than 0` }
    }
    if (priceMinor > MAX_TICKET_PRICE_MINOR) {
      return { error: `Ticket type "${name}" is priced above the maximum allowed` }
    }
    if (!Number.isInteger(totalQuantity) || totalQuantity <= 0) {
      return { error: `Ticket type "${name}" must have a total quantity greater than 0` }
    }
    let maxPerOrder = Number(t?.maxPerOrder)
    if (!Number.isInteger(maxPerOrder) || maxPerOrder < 1) maxPerOrder = 5
    const salesStart = parseDate(t?.salesStart)
    const salesEnd = parseDate(t?.salesEnd)
    if (salesStart === 'invalid' || salesEnd === 'invalid') {
      return { error: `Ticket type "${name}" has an invalid sales window date` }
    }
    data.push({
      name,
      description: typeof t?.description === 'string' && t.description.trim() ? t.description.trim() : null,
      priceMinor,
      totalQuantity,
      maxPerOrder,
      salesStart: salesStart || null,
      salesEnd: salesEnd || null,
    })
  }
  return { data }
}

/** GET /api/organizer/events — the organizer's own events, newest first. */
export async function GET() {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const events = await db.event.findMany({
      where: { organizerId: organizer.id },
      orderBy: { createdAt: 'desc' },
      include: {
        ticketTypes: true,
        _count: { select: { orders: true } },
      },
    })
    return NextResponse.json(jsonSafe({ events }))
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/events failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}

/** POST /api/organizer/events — create a DRAFT or PENDING_APPROVAL event. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })
    if (organizer.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Your organizer account must be approved before creating events' },
        { status: 403 }
      )
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const title = str(body.title)
    const description = str(body.description)
    const category = str(body.category)
    const city = str(body.city)
    const venue = str(body.venue)
    const address = str(body.address)
    const startTime = str(body.startTime)
    const endTime = str(body.endTime)
    const banner = str(body.banner) || null
    const rawMapUrl = str(body.mapUrl)
    const mapUrl = rawMapUrl ? safeHttpUrl(rawMapUrl) : null
    if (rawMapUrl && !mapUrl) {
      return NextResponse.json({ error: 'Map URL must be a valid http(s) link' }, { status: 400 })
    }

    if (!title || !description || !category || !city || !venue || !address || !startTime || !endTime) {
      return NextResponse.json({ error: 'All event fields are required' }, { status: 400 })
    }
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    const startDate = parseDate(body.startDate)
    const endDate = parseDate(body.endDate)
    if (startDate === 'invalid' || startDate === null) {
      return NextResponse.json({ error: 'A valid start date is required' }, { status: 400 })
    }
    if (endDate === 'invalid' || endDate === null) {
      return NextResponse.json({ error: 'A valid end date is required' }, { status: 400 })
    }
    if (endDate.getTime() < startDate.getTime()) {
      return NextResponse.json({ error: 'End date cannot be before the start date' }, { status: 400 })
    }

    const tts = normalizeTicketTypes(body.ticketTypes)
    if (tts.error || !tts.data) {
      return NextResponse.json({ error: tts.error ?? 'Invalid ticket types' }, { status: 400 })
    }

    // Generated once here and never regenerated on rename, so the public URL
    // for an event is a stable permalink.
    const slug = await uniqueEventSlug(db, title)

    const event = await db.event.create({
      data: {
        organizerId: organizer.id,
        title,
        slug,
        description,
        category,
        banner,
        startDate,
        endDate,
        startTime,
        endTime,
        venue,
        address,
        city,
        mapUrl,
        status: body.submit ? 'PENDING_APPROVAL' : 'DRAFT',
        ticketTypes: { create: tts.data },
      },
      include: { ticketTypes: true },
    })

    return NextResponse.json(jsonSafe({ event }), { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/organizer/events failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
  }
}
