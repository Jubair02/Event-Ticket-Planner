import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/**
 * PUT /api/organizer/ticket-types/[id] — update an owned ticket type.
 * totalQuantity cannot drop below the sold quantity.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const ticketType = await db.ticketType.findUnique({ where: { id }, include: { event: true } })
    if (!ticketType || ticketType.event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      data.name = name
    }
    if ('description' in body) {
      data.description =
        typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
    }
    if (body.price !== undefined) {
      const price = Number(body.price)
      if (!Number.isFinite(price) || price <= 0) {
        return NextResponse.json({ error: 'Price must be greater than 0' }, { status: 400 })
      }
      data.price = price
    }
    if (body.totalQuantity !== undefined) {
      const totalQuantity = Number(body.totalQuantity)
      if (!Number.isInteger(totalQuantity) || totalQuantity <= 0) {
        return NextResponse.json({ error: 'Total quantity must be greater than 0' }, { status: 400 })
      }
      if (totalQuantity < ticketType.soldQuantity) {
        return NextResponse.json(
          { error: `Total quantity cannot be less than the ${ticketType.soldQuantity} already sold` },
          { status: 400 }
        )
      }
      data.totalQuantity = totalQuantity
    }
    if (body.maxPerOrder !== undefined) {
      const maxPerOrder = Number(body.maxPerOrder)
      if (!Number.isInteger(maxPerOrder) || maxPerOrder < 1) {
        return NextResponse.json({ error: 'Max per order must be at least 1' }, { status: 400 })
      }
      data.maxPerOrder = maxPerOrder
    }
    const toNullableDate = (v: unknown): Date | null | 'invalid' => {
      if (v === undefined || v === null || v === '') return null
      const d = new Date(String(v))
      return Number.isNaN(d.getTime()) ? 'invalid' : d
    }
    if ('salesStart' in body) {
      const d = toNullableDate(body.salesStart)
      if (d === 'invalid') return NextResponse.json({ error: 'Invalid sales start date' }, { status: 400 })
      data.salesStart = d
    }
    if ('salesEnd' in body) {
      const d = toNullableDate(body.salesEnd)
      if (d === 'invalid') return NextResponse.json({ error: 'Invalid sales end date' }, { status: 400 })
      data.salesEnd = d
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await db.ticketType.update({ where: { id: ticketType.id }, data })
    return NextResponse.json({ ticketType: updated })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PUT /api/organizer/ticket-types/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update ticket type' }, { status: 500 })
  }
}

/** DELETE /api/organizer/ticket-types/[id] — only when nothing has been sold. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const ticketType = await db.ticketType.findUnique({ where: { id }, include: { event: true } })
    if (!ticketType || ticketType.event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 })
    }

    if (ticketType.soldQuantity !== 0) {
      return NextResponse.json({ error: 'Cannot delete a ticket type that has sold tickets' }, { status: 409 })
    }

    const ticketCount = await db.ticket.count({ where: { ticketTypeId: ticketType.id } })
    if (ticketCount > 0) {
      return NextResponse.json({ error: 'Cannot delete a ticket type that has issued tickets' }, { status: 409 })
    }

    await db.ticketType.delete({ where: { id: ticketType.id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('DELETE /api/organizer/ticket-types/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to delete ticket type' }, { status: 500 })
  }
}
