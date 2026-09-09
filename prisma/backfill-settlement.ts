/*
 * Backfills organizer ledger entries for orders that predate the settlement
 * system. Idempotent — run it as often as you like:
 *
 *   bun prisma/backfill-settlement.ts
 */
import { PrismaClient } from '@prisma/client'
import { backfillLedger, computeBalances } from '../src/lib/settlement'

const db = new PrismaClient()

async function main() {
  console.log('Backfilling organizer ledger...')
  const { orders, refunded } = await backfillLedger(db)
  console.log(`   paid orders processed:     ${orders}`)
  console.log(`   refunded orders processed: ${refunded}`)

  const organizers = await db.organizer.findMany({
    select: { id: true, organizationName: true },
    orderBy: { organizationName: 'asc' },
  })
  console.log('')
  for (const o of organizers) {
    const b = await computeBalances(db, o.id)
    console.log(
      `   ${o.organizationName}: available ${b.available}, pending ${b.pending}, paid ${b.paid} (gross ${b.grossSales}, fees ${b.platformFees}, refunds ${b.refunds})`,
    )
  }
  console.log('')
  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
