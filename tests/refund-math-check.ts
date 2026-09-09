/**
 * Verification of the refund arithmetic in src/lib/refunds.ts.
 *
 *   bun run tests/refund-math-check.ts
 *
 * No database and no gateway: this exercises the pure policy resolver and the
 * quote arithmetic, which is where a money bug would be both easiest to
 * introduce and hardest to notice. The invariants asserted for every case are
 * the ones the database enforces as CHECK constraints:
 *
 *   - item amounts sum to the refund total exactly (no paisa lost to rounding)
 *   - organizerShare + platformShare == amount, and neither is negative
 *   - amount > 0 and never exceeds what is left refundable on the order
 *
 * The last section fuzzes 400 random orders against five policies, because the
 * rounding edges are exactly the cases nobody writes by hand.
 */
import {
  RefundError,
  allocateProportional,
  quoteRefund,
  resolveRefundPolicy,
  type RefundPolicy,
} from '@/lib/refunds'

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log('  ok   ', name)
  } else {
    failures++
    console.log('  FAIL ', name, detail === undefined ? '' : JSON.stringify(detail))
  }
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000)

function order(subtotal: number, fee: number, discount = 0, refunded = 0) {
  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    platformFeeMinor: fee,
    totalMinor: subtotal - discount + fee,
    refundedMinor: refunded,
  }
}

const t = (id: string, faceValueMinor: number, status = 'ACTIVE') => ({ id, faceValueMinor, status })

function invariants(label: string, q: ReturnType<typeof quoteRefund>) {
  const lineSum = q.lines.reduce((s, l) => s + l.amountMinor, 0)
  check(`${label}: lines sum to amount`, lineSum === q.amountMinor, { lineSum, amount: q.amountMinor })
  check(
    `${label}: shares sum to amount`,
    q.organizerShareMinor + q.platformShareMinor === q.amountMinor,
    { org: q.organizerShareMinor, plat: q.platformShareMinor, amount: q.amountMinor }
  )
  check(`${label}: shares non-negative`, q.organizerShareMinor >= 0 && q.platformShareMinor >= 0, {
    org: q.organizerShareMinor,
    plat: q.platformShareMinor,
  })
  check(`${label}: amount positive`, q.amountMinor > 0, q.amountMinor)
  check(
    `${label}: breakdown reconciles`,
    q.ticketFaceValueMinor + q.platformFeeRefundedMinor - q.processingFeeMinor === q.amountMinor
  )
  check(`${label}: all integers`, q.lines.every((l) => Number.isInteger(l.amountMinor)))
  check(`${label}: within ceiling`, q.amountMinor <= q.refundableRemainingMinor)
}

console.log('\n1. allocateProportional keeps every paisa')
check('50 across [33,33,33]', allocateProportional(50, [33, 33, 33]).reduce((a, b) => a + b, 0) === 50, allocateProportional(50, [33, 33, 33]))
check('100 across [1,1,1]', allocateProportional(100, [1, 1, 1]).reduce((a, b) => a + b, 0) === 100, allocateProportional(100, [1, 1, 1]))
check('7 across [0,0,0] (free tickets)', allocateProportional(7, [0, 0, 0]).reduce((a, b) => a + b, 0) === 7, allocateProportional(7, [0, 0, 0]))
check('0 across [5,5]', allocateProportional(0, [5, 5]).reduce((a, b) => a + b, 0) === 0)
check('1 across [1,1,1,1,1,1,1]', allocateProportional(1, [1, 1, 1, 1, 1, 1, 1]).reduce((a, b) => a + b, 0) === 1)
check('999 across [7,11,13]', allocateProportional(999, [7, 11, 13]).reduce((a, b) => a + b, 0) === 999, allocateProportional(999, [7, 11, 13]))

console.log('\n2. Cancelled event: whole order back, fees included')
const cancelledPolicy = resolveRefundPolicy({
  reasonCode: 'CUSTOMER_REQUEST', // a customer filing against a dead event
  eventStartDate: hoursFromNow(2), // inside the cutoff - must be overridden
  eventStatus: 'CANCELLED',
})
check('cancelled beats the voluntary tiers', cancelledPolicy.code === 'EVENT_CANCELLED_FULL', cancelledPolicy)
const q1 = quoteRefund({
  order: order(200000, 6000),
  tickets: [t('a', 100000), t('b', 50000), t('c', 50000)],
  policy: cancelledPolicy,
})
invariants('cancelled', q1)
check('cancelled returns the full total', q1.amountMinor === 206000, q1.amountMinor)
check('cancelled retains nothing', q1.processingFeeMinor === 0)
check('cancelled returns the fee', q1.platformFeeRefundedMinor === 6000, q1.platformFeeRefundedMinor)

console.log('\n3. Voluntary tiers')
for (const [hours, expectedCode, expectedFace] of [
  [200, 'CUSTOMER_TIER_FULL', 200000],
  [100, 'CUSTOMER_TIER_50', 100000],
  [40, 'CUSTOMER_TIER_25', 50000],
] as const) {
  const policy = resolveRefundPolicy({
    reasonCode: 'CUSTOMER_REQUEST',
    eventStartDate: hoursFromNow(hours),
    eventStatus: 'PUBLISHED',
  })
  check(`${hours}h out -> ${expectedCode}`, policy.code === expectedCode, policy.code)
  const q = quoteRefund({
    order: order(200000, 6000),
    tickets: [t('a', 100000), t('b', 50000), t('c', 50000)],
    policy,
  })
  invariants(`tier ${expectedCode}`, q)
  check(`${expectedCode} face value`, q.ticketFaceValueMinor === expectedFace, q.ticketFaceValueMinor)
  check(`${expectedCode} keeps the platform fee`, q.platformFeeRefundedMinor === 0)
  check(
    `${expectedCode} retains 2%`,
    q.processingFeeMinor === Math.round(expectedFace * 0.02),
    q.processingFeeMinor
  )
  check(
    `${expectedCode} organizer share is net of the retention`,
    q.organizerShareMinor === expectedFace - q.processingFeeMinor
  )
}

console.log('\n4. Inside the cutoff, a voluntary refund is refused')
try {
  resolveRefundPolicy({
    reasonCode: 'CUSTOMER_REQUEST',
    eventStartDate: hoursFromNow(5),
    eventStatus: 'PUBLISHED',
  })
  check('under 24h throws', false)
} catch (e) {
  check('under 24h throws REFUND_WINDOW_CLOSED', e instanceof RefundError && e.code === 'REFUND_WINDOW_CLOSED')
}
try {
  resolveRefundPolicy({
    reasonCode: 'CUSTOMER_REQUEST',
    eventStartDate: hoursFromNow(-5),
    eventStatus: 'ONGOING',
  })
  check('already started throws', false)
} catch (e) {
  check('already started throws', e instanceof RefundError && e.code === 'REFUND_WINDOW_CLOSED')
}

console.log('\n5. Admin reason codes are always whole, fee included')
const adminPolicy = resolveRefundPolicy({
  reasonCode: 'DUPLICATE_ORDER',
  eventStartDate: hoursFromNow(1), // even inside the cutoff
  eventStatus: 'PUBLISHED',
})
check('admin reason -> 100%', adminPolicy.faceValueRate === 1 && adminPolicy.refundPlatformFee)
check('admin reason retains nothing', adminPolicy.processingFeeRate === 0)

console.log('\n6. Partial refund: one ticket of three')
const q6 = quoteRefund({
  order: order(200000, 6000),
  tickets: [t('b', 50000)],
  policy: adminPolicy,
})
invariants('partial', q6)
check('partial face value', q6.ticketFaceValueMinor === 50000, q6.ticketFaceValueMinor)
check('partial fee share is pro-rata (1500 of 6000)', q6.platformFeeRefundedMinor === 1500, q6.platformFeeRefundedMinor)
check('partial amount', q6.amountMinor === 51500, q6.amountMinor)

console.log('\n7. Awkward rounding never loses or invents a paisa')
const q7 = quoteRefund({
  order: order(99, 3),
  tickets: [t('a', 33), t('b', 33), t('c', 33)],
  policy: resolveRefundPolicy({
    reasonCode: 'CUSTOMER_REQUEST',
    eventStartDate: hoursFromNow(100),
    eventStatus: 'PUBLISHED',
  }),
})
invariants('rounding 50% of 3x33', q7)
const q7b = quoteRefund({
  order: order(100003, 3000),
  tickets: [t('a', 33334), t('b', 33334), t('c', 33335)],
  policy: resolveRefundPolicy({
    reasonCode: 'CUSTOMER_REQUEST',
    eventStartDate: hoursFromNow(100),
    eventStatus: 'PUBLISHED',
  }),
})
invariants('rounding odd thirds', q7b)

console.log('\n8. The ceiling stops an over-refund')
try {
  quoteRefund({
    order: order(200000, 6000, 0, 200000), // 6000 paisa left
    tickets: [t('a', 100000)],
    policy: adminPolicy,
  })
  check('over-refund throws', false)
} catch (e) {
  check(
    'over-refund throws REFUND_EXCEEDS_REMAINING',
    e instanceof RefundError && e.code === 'REFUND_EXCEEDS_REMAINING',
    e instanceof RefundError ? e.code : e
  )
}

console.log('\n9. A discount means face value is not what was paid')
const q9 = quoteRefund({
  order: order(200000, 5400, 20000), // paid 90% of face
  tickets: [t('a', 100000), t('b', 50000), t('c', 50000)],
  policy: cancelledPolicy,
})
invariants('discounted order', q9)
check('discounted refund is scaled to what was paid', q9.ticketFaceValueMinor === 180000, q9.ticketFaceValueMinor)

console.log('\n10. A zero-value refund is refused rather than created')
try {
  quoteRefund({
    order: order(0, 0),
    tickets: [t('a', 0)],
    policy: cancelledPolicy,
  })
  check('zero refund throws', false)
} catch (e) {
  check('zero refund throws', e instanceof RefundError && e.code === 'REFUND_ZERO_AMOUNT', e instanceof RefundError ? e.code : e)
}

console.log('\n11. Fuzz: 400 random orders, invariants must always hold')
let fuzzChecked = 0
const policies: RefundPolicy[] = [
  cancelledPolicy,
  adminPolicy,
  { code: 'T50', label: '', faceValueRate: 0.5, refundPlatformFee: false, processingFeeRate: 0.02 },
  { code: 'T25', label: '', faceValueRate: 0.25, refundPlatformFee: false, processingFeeRate: 0.02 },
  { code: 'ODD', label: '', faceValueRate: 1 / 3, refundPlatformFee: true, processingFeeRate: 0.017 },
]
for (let i = 0; i < 400; i++) {
  const n = 1 + Math.floor(Math.random() * 6)
  const prices = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 500000))
  const subtotal = prices.reduce((a, b) => a + b, 0)
  const fee = Math.round(subtotal * 0.03)
  const policy = policies[i % policies.length]
  const takeCount = 1 + Math.floor(Math.random() * n)
  try {
    const q = quoteRefund({
      order: order(subtotal, fee),
      tickets: prices.slice(0, takeCount).map((p, idx) => t(`t${idx}`, p)),
      policy,
    })
    const lineSum = q.lines.reduce((s, l) => s + l.amountMinor, 0)
    if (
      lineSum !== q.amountMinor ||
      q.organizerShareMinor + q.platformShareMinor !== q.amountMinor ||
      q.organizerShareMinor < 0 ||
      q.platformShareMinor < 0 ||
      q.amountMinor > q.refundableRemainingMinor ||
      !Number.isInteger(q.amountMinor)
    ) {
      failures++
      console.log('  FAIL  fuzz case', { prices, takeCount, policy: policy.code, q })
      break
    }
    fuzzChecked++
  } catch (e) {
    if (!(e instanceof RefundError)) {
      failures++
      console.log('  FAIL  fuzz threw a non-RefundError', e)
      break
    }
  }
}
check(`fuzz: ${fuzzChecked} quotes all reconciled`, fuzzChecked > 300, fuzzChecked)

console.log(failures === 0 ? '\nALL REFUND MATH CHECKS PASSED\n' : `\n${failures} FAILURE(S)\n`)
process.exit(failures === 0 ? 0 : 1)
