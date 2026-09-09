import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { MAX_TICKET_PRICE_MINOR, isMinor } from '@/lib/money'
import { jsonSafe } from '@/lib/serialize'

/** POST /api/organizer/events/[id]/ticket-types — add a ticket type to an owned event. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })
    if (organizer.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Your organizer account must be approved first' }, { status: 403 })
    }

    const { id } = await params
    const event = await db.event.findUnique({ where: { id } })
    if (!event || event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    // The wire carries paisa, not taka: the form parses what the person typed
    // with `toMinor` and sends an integer, so no decimal ever reaches the
    // server to be re-parsed (and re-rounded) a second way.
    const priceMinor = Number(body.priceMinor)
    const totalQuantity = Number(body.totalQuantity)
    if (!name) return NextResponse.json({ error: 'Ticket type name is required' }, { status: 400 })
    if (!isMinor(priceMinor) || priceMinor <= 0) {
      return NextResponse.json({ error: 'Price must be greater than 0' }, { status: 400 })
    }
    if (priceMinor > MAX_TICKET_PRICE_MINOR) {
      return NextResponse.json({ error: 'Price is above the maximum allowed' }, { status: 400 })
    }
    if (!Number.isInteger(totalQuantity) || totalQuantity <= 0) {
      return NextResponse.json({ error: 'Total quantity must be greater than 0' }, { status: 400 })
    }

    let maxPerOrder = Number(body.maxPerOrder)
    if (!Number.isInteger(maxPerOrder) || maxPerOrder < 1) maxPerOrder = 5

    const toNullableDate = (v: unknown): Date | null | 'invalid' => {
      if (v === undefined || v === null || v === '') return null
      const d = new Date(String(v))
      return Number.isNaN(d.getTime()) ? 'invalid' : d
    }
    const salesStart = toNullableDate(body.salesStart)
    const salesEnd = toNullableDate(body.salesEnd)
    if (salesStart === 'invalid' || salesEnd === 'invalid') {
      return NextResponse.json({ error: 'Invalid sales window date' }, { status: 400 })
    }

    const ticketType = await db.ticketType.create({
      data: {
        eventId: event.id,
        name,
        description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
        priceMinor,
        totalQuantity,
        maxPerOrder,
        salesStart: salesStart || null,
        salesEnd: salesEnd || null,
      },
    })

    return NextResponse.json(jsonSafe({ ticketType }), { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/organizer/events/[id]/ticket-types failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to create ticket type' }, { status: 500 })
  }
}
