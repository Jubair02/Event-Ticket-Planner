import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireOrganizer } from '@/lib/auth'
import { PAYOUT_METHOD_TYPES, safePayoutMethod, type PayoutMethodType } from '@/lib/settlement'

const MAX_METHODS = 5

/** Digits only, so `017 1234 5678` and `01712345678` are treated as one number. */
function normaliseAccount(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

/** GET /api/organizer/payout-methods — active destinations (never full numbers). */
export async function GET() {
  try {
    const { organizer } = await requireOrganizer()
    const methods = await db.payoutMethod.findMany({
      where: { organizerId: organizer.id, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })
    return NextResponse.json({ methods: methods.map(safePayoutMethod) })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/payout-methods failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load payout methods' }, { status: 500 })
  }
}

/** POST /api/organizer/payout-methods — add a destination. */
export async function POST(req: NextRequest) {
  try {
    const { organizer } = await requireOrganizer()
    const body = (await req.json().catch(() => null)) as {
      type?: unknown
      accountName?: unknown
      accountNumber?: unknown
      bankName?: unknown
      branch?: unknown
      makeDefault?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const type = String(body.type ?? '').toUpperCase()
    if (!(PAYOUT_METHOD_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: 'Choose bKash, Nagad or a bank account' }, { status: 400 })
    }

    const accountName = String(body.accountName ?? '').trim()
    if (accountName.length < 2) {
      return NextResponse.json({ error: 'Enter the account holder name' }, { status: 400 })
    }

    const accountNumber = normaliseAccount(String(body.accountNumber ?? '').trim())
    const isBank = type === 'BANK'
    // Mobile wallets in Bangladesh are 11-digit MSISDNs; bank accounts vary by
    // bank, so only a loose length bound is enforced there.
    const numberOk = isBank
      ? /^[0-9]{6,24}$/.test(accountNumber)
      : /^01[0-9]{9}$/.test(accountNumber)
    if (!numberOk) {
      return NextResponse.json(
        {
          error: isBank
            ? 'Enter a valid bank account number (digits only)'
            : 'Enter an 11-digit mobile wallet number, e.g. 01712345678',
        },
        { status: 400 },
      )
    }

    const bankName = String(body.bankName ?? '').trim()
    if (isBank && bankName.length < 2) {
      return NextResponse.json({ error: 'Enter the bank name' }, { status: 400 })
    }

    const active = await db.payoutMethod.count({
      where: { organizerId: organizer.id, archivedAt: null },
    })
    if (active >= MAX_METHODS) {
      return NextResponse.json(
        { error: `You can keep up to ${MAX_METHODS} payout methods. Remove one first.` },
        { status: 400 },
      )
    }

    // Matched on the last four digits plus the account name, because the full
    // number is deliberately never stored (see the PayoutMethod comment in
    // schema.prisma). That is a slightly weaker check than comparing whole
    // numbers: two accounts at the same bank sharing a name and last four
    // digits would be treated as one. Holding every organizer's full account
    // number to sharpen a convenience check is the worse trade.
    const duplicate = await db.payoutMethod.findFirst({
      where: {
        organizerId: organizer.id,
        archivedAt: null,
        type,
        accountName,
        accountLast4: accountNumber.slice(-4),
      },
    })
    if (duplicate) {
      return NextResponse.json({ error: 'That account is already saved' }, { status: 400 })
    }

    // First method added is the default whether or not it was asked for, so a
    // payout request always has a destination to fall back on.
    const makeDefault = body.makeDefault === true || active === 0

    const method = await db.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.payoutMethod.updateMany({
          where: { organizerId: organizer.id, isDefault: true },
          data: { isDefault: false },
        })
      }
      return tx.payoutMethod.create({
        data: {
          organizerId: organizer.id,
          type: type as PayoutMethodType,
          accountName,
          // Only the last four digits are kept; `accountNumber` is used to
          // derive them and then goes out of scope with the request.
          accountLast4: accountNumber.slice(-4),
          label: accountName,
          bankName: isBank ? bankName : null,
          branchName: isBank ? String(body.branch ?? '').trim() || null : null,
          isDefault: makeDefault,
        },
      })
    })

    return NextResponse.json({ method: safePayoutMethod(method) }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/organizer/payout-methods failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to save payout method' }, { status: 500 })
  }
}
