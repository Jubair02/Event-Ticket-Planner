/* Seed script for TicketBD MVP — run with: bun prisma/seed.ts */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const db = new PrismaClient()

function daysFromNow(days: number, hour = 18, minute = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, minute, 0, 0)
  return d
}

let ticketSeq = 100
function nextTicketCode(): string {
  ticketSeq += 1
  return `EVT-${new Date().getFullYear()}-${String(ticketSeq).padStart(6, '0')}`
}
function nextQrToken(): string {
  return `qr_${crypto.randomBytes(12).toString('hex')}`
}

async function main() {
  console.log('🌱 Seeding TicketBD database...')

  // ---- wipe (FK order) ----
  await db.staffAssignment.deleteMany()
  await db.payment.deleteMany()
  await db.ticket.deleteMany()
  await db.order.deleteMany()
  await db.ticketType.deleteMany()
  await db.event.deleteMany()
  await db.organizer.deleteMany()
  await db.user.deleteMany()

  const pw = (p: string) => bcrypt.hashSync(p, 10)

  // ---- users ----
  const admin = await db.user.create({
    data: {
      name: 'Platform Admin',
      email: 'admin@ticketbd.com',
      phone: '+8801700000001',
      password: pw('admin123'),
      role: 'SUPER_ADMIN',
    },
  })

  const organizerUser = await db.user.create({
    data: {
      name: 'Rafiq Ahmed',
      email: 'organizer@ticketbd.com',
      phone: '+8801700000002',
      password: pw('organizer123'),
      role: 'ORGANIZER',
    },
  })
  const organizer = await db.organizer.create({
    data: {
      userId: organizerUser.id,
      organizationName: 'SoundWave Entertainment',
      phone: '+8801700000002',
      status: 'APPROVED',
    },
  })

  // A pending organizer for admin approval demo
  const pendingOrgUser = await db.user.create({
    data: {
      name: 'Nadia Chowdhury',
      email: 'nadia@eventprobd.com',
      phone: '+8801700000007',
      password: pw('organizer123'),
      role: 'ORGANIZER',
    },
  })
  await db.organizer.create({
    data: {
      userId: pendingOrgUser.id,
      organizationName: 'EventPro Bangladesh',
      phone: '+8801700000007',
      status: 'PENDING',
    },
  })

  const customer = await db.user.create({
    data: {
      name: 'Jubair Hossain',
      email: 'customer@ticketbd.com',
      phone: '+8801700000003',
      password: pw('customer123'),
      role: 'CUSTOMER',
    },
  })

  const staffUser = await db.user.create({
    data: {
      name: 'Kamal Uddin',
      email: 'staff@ticketbd.com',
      phone: '+8801700000004',
      password: pw('staff123'),
      role: 'EVENT_STAFF',
      createdByOrganizerId: organizer.id,
    },
  })

  // extra demo customers
  const extraCustomersData = [
    { name: 'Rakib Hasan', email: 'rakib@example.com', phone: '+8801811111101' },
    { name: 'Sadia Islam', email: 'sadia@example.com', phone: '+8801811111102' },
    { name: 'Tanvir Alam', email: 'tanvir@example.com', phone: '+8801811111103' },
    { name: 'Nusrat Jahan', email: 'nusrat@example.com', phone: '+8801811111104' },
    { name: 'Arif Chowdhury', email: 'arif@example.com', phone: '+8801811111105' },
    { name: 'Mim Akter', email: 'mim@example.com', phone: '+8801811111106' },
  ]
  const extraCustomers: { id: string; name: string }[] = []
  for (const c of extraCustomersData) {
    const u = await db.user.create({
      data: { ...c, password: pw('customer123'), role: 'CUSTOMER' },
    })
    extraCustomers.push({ id: u.id, name: u.name })
  }

  // ---- events ----
  const banner = (name: string) => `/banners/${name}.png`

  const musicFest = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Dhaka Summer Music Festival 2026',
      description:
        'The biggest open-air music festival in Bangladesh is back! Join thousands of music lovers at Army Stadium, Dhaka for an unforgettable night.\n\nFeaturing headline performances from top Bangladeshi bands and artists — rock, pop, folk fusion and indie all on one stage. Food stalls, merchandise booths and a vibrant festival village throughout the evening.\n\nGates open at 4:00 PM. Show starts at 6:00 PM. This is an 18+ event — bring your NID/Student ID along with your e-ticket QR code.',
      category: 'CONCERT',
      banner: banner('music'),
      startDate: daysFromNow(12),
      endDate: daysFromNow(12, 23, 30),
      startTime: '16:00',
      endTime: '23:30',
      venue: 'Army Stadium',
      address: 'Bijoy Sarani, Dhaka Cantonment',
      city: 'Dhaka',
      mapUrl: 'https://maps.google.com/?q=Army+Stadium+Dhaka',
      status: 'PUBLISHED',
      featured: true,
      ticketTypes: {
        create: [
          { name: 'General', description: 'Standing zone access', price: 500, totalQuantity: 1000, maxPerOrder: 5 },
          { name: 'VIP', description: 'Reserved seating + food voucher', price: 1500, totalQuantity: 300, maxPerOrder: 4 },
          { name: 'VVIP', description: 'Front row lounge + backstage tour + dinner', price: 3000, totalQuantity: 100, maxPerOrder: 2 },
        ],
      },
    },
  })

  const techSummit = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Dhaka Tech Summit 2026',
      description:
        'Bangladesh\'s premier technology conference returns bigger than ever. Two days of keynotes, workshops and networking with 60+ speakers from leading tech companies, startups and academia.\n\nTracks: AI & Machine Learning, Fintech, DevOps & Cloud, Product Design, Startup Founder stories. Includes hands-on workshops, hiring lounge and startup demo expo.\n\nRegistration includes lunch, snacks and summit kit.',
      category: 'TECH',
      banner: banner('tech'),
      startDate: daysFromNow(25),
      endDate: daysFromNow(26, 17, 0),
      startTime: '09:00',
      endTime: '17:00',
      venue: 'Bangabandhu International Conference Center',
      address: 'Agargaon, Dhaka',
      city: 'Dhaka',
      mapUrl: 'https://maps.google.com/?q=BICC+Dhaka',
      status: 'PUBLISHED',
      featured: true,
      ticketTypes: {
        create: [
          { name: 'Early Bird', description: 'Limited early access pass', price: 1000, totalQuantity: 200, maxPerOrder: 4 },
          { name: 'Standard', description: 'Full 2-day access', price: 2000, totalQuantity: 500, maxPerOrder: 5 },
          { name: 'VIP Pass', description: 'Front rows + speaker dinner + workshop priority', price: 5000, totalQuantity: 50, maxPerOrder: 2 },
        ],
      },
    },
  })

  const foodFest = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Sylhet Street Food Fest 2026',
      description:
        'A celebration of Bengali street food! Over 80 stalls serving everything from fuchka and chotpoti to authentic Sylheti tea and traditional desserts.\n\nLive cooking shows, family zones, folk music performances all evening. Free entry for children under 5.',
      category: 'FOOD',
      banner: banner('food'),
      startDate: daysFromNow(40),
      endDate: daysFromNow(42, 22, 0),
      startTime: '11:00',
      endTime: '22:00',
      venue: 'Sylhet District Shishu Park Grounds',
      address: 'Amberkhana, Sylhet',
      city: 'Sylhet',
      status: 'PUBLISHED',
      ticketTypes: {
        create: [
          { name: 'Day Pass', description: 'Single day entry', price: 200, totalQuantity: 800, maxPerOrder: 8 },
          { name: 'Family Pack', description: '4 entries + 8 food coupons', price: 800, totalQuantity: 150, maxPerOrder: 3 },
        ],
      },
    },
  })

  const bizConf = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Chattogram Business Leadership Conference',
      description:
        'A full-day conference for entrepreneurs, executives and aspiring leaders. Keynotes from Bangladesh\'s top CEOs, panels on export economy, logistics, and digital transformation of trade.\n\nNetworking lunch and B2B matchmaking lounge included.',
      category: 'BUSINESS',
      banner: banner('business'),
      startDate: daysFromNow(55),
      endDate: daysFromNow(55, 21, 0),
      startTime: '09:30',
      endTime: '21:00',
      venue: 'World Trade Center, Agrabad',
      address: 'Agrabad Commercial Area, Chattogram',
      city: 'Chattogram',
      status: 'PUBLISHED',
      ticketTypes: {
        create: [
          { name: 'Standard', description: 'Full day access + lunch', price: 1500, totalQuantity: 300, maxPerOrder: 5 },
        ],
      },
    },
  })

  const gamingCon = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: "Cox's Bazar Beach Gaming Con 2026",
      description:
        'The first beachside gaming convention in Bangladesh! Esports tournaments (Valorant, FIFA, Mobile Legends), retro arcade zone, cosplay parade and meet-and-greet with top BD streamers.\n\nTournament registration included with Gamer Pass.',
      category: 'GAMING',
      banner: banner('gaming'),
      startDate: daysFromNow(70),
      endDate: daysFromNow(71, 23, 0),
      startTime: '10:00',
      endTime: '23:00',
      venue: 'Sugandha Beach Point',
      address: 'Hotel Motel Zone, Cox\'s Bazar',
      city: "Cox's Bazar",
      status: 'PUBLISHED',
      ticketTypes: {
        create: [
          { name: 'Gamer Pass', description: '3-day entry + tournament registration', price: 800, totalQuantity: 400, maxPerOrder: 4 },
          { name: 'Spectator', description: '3-day entry, no tournament', price: 300, totalQuantity: 600, maxPerOrder: 6 },
        ],
      },
    },
  })

  const cultural = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Rajshahi Cultural Evening — Boishakh Celebration',
      description:
        'Celebrate the Bengali New Year with an evening of folk songs, Baul performances, traditional dance and poetry recitation. Featuring folk artists from across the Rajshahi division.\n\nLocal craft stalls and authentic Rajshahi silk exhibition on-site.',
      category: 'CULTURAL',
      banner: banner('cultural'),
      startDate: daysFromNow(20),
      endDate: daysFromNow(20, 22, 0),
      startTime: '17:00',
      endTime: '22:00',
      venue: 'Rajshahi College Auditorium Field',
      address: 'Rajshahi College Road, Rajshahi',
      city: 'Rajshahi',
      status: 'PUBLISHED',
      ticketTypes: {
        create: [
          { name: 'General', description: 'Open ground seating', price: 300, totalQuantity: 600, maxPerOrder: 6 },
        ],
      },
    },
  })

  const sports = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'National Cricket Coaching Workshop — Khulna',
      description:
        'A 3-day intensive cricket coaching camp led by BCB-certified coaches. Open for players aged 14-22. Covers batting technique, fast bowling mechanics, wicket-keeping drills and match strategy.\n\nParticipants receive a certificate and kit bag.',
      category: 'SPORTS',
      banner: banner('sports'),
      startDate: daysFromNow(90),
      endDate: daysFromNow(92, 17, 0),
      startTime: '08:00',
      endTime: '17:00',
      venue: 'Khan Shaheb Osman Ali Stadium Ground',
      address: 'Khalishpur, Khulna',
      city: 'Khulna',
      status: 'PUBLISHED',
      ticketTypes: {
        create: [
          { name: 'Participant Pass', description: '3-day camp + kit + certificate', price: 2500, totalQuantity: 150, maxPerOrder: 2 },
          { name: 'Spectator', description: 'Watch the camp sessions', price: 100, totalQuantity: 300, maxPerOrder: 5 },
        ],
      },
    },
  })

  const workshop = await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'AI for Startups — Hands-on Workshop, Dhaka',
      description:
        'A practical one-day workshop for founders and product teams: build an AI-powered MVP in a day. Covers prompt engineering, RAG pipelines, AI agents, and shipping LLM features to production.\n\nBring a laptop — all exercises are hands-on. Seats are limited.',
      category: 'WORKSHOP',
      banner: banner('workshop'),
      startDate: daysFromNow(15),
      endDate: daysFromNow(15, 17, 30),
      startTime: '10:00',
      endTime: '17:30',
      venue: 'GP House Innovation Lab',
      address: 'Gulshan-1, Dhaka',
      city: 'Dhaka',
      status: 'PUBLISHED',
      ticketTypes: {
        create: [
          { name: 'Student', description: 'Valid student ID required', price: 300, totalQuantity: 80, maxPerOrder: 2 },
          { name: 'Professional', description: 'Includes lunch + resources', price: 800, totalQuantity: 120, maxPerOrder: 4 },
        ],
      },
    },
  })

  // A pending-approval event for admin demo
  await db.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Winter Pohela Falgun Mela (Draft Submission)',
      description:
        'A spring festival fair awaiting platform approval — craft stalls, kite flying, cultural program in Dhaka.',
      category: 'CULTURAL',
      banner: banner('cultural'),
      startDate: daysFromNow(110),
      endDate: daysFromNow(110, 21, 0),
      startTime: '15:00',
      endTime: '21:00',
      venue: 'Ramna Park',
      address: 'Ramna, Dhaka',
      city: 'Dhaka',
      status: 'PENDING_APPROVAL',
      ticketTypes: {
        create: [{ name: 'General', price: 150, totalQuantity: 500, maxPerOrder: 5 }],
      },
    },
  })

  // ---- staff assignments ----
  await db.staffAssignment.createMany({
    data: [
      { userId: staffUser.id, eventId: musicFest.id },
      { userId: staffUser.id, eventId: techSummit.id },
      { userId: staffUser.id, eventId: workshop.id },
    ],
  })

  // ---- demo orders + tickets ----
  const staff = staffUser

  async function createPaidOrder(opts: {
    user: { id: string; name: string }
    event: typeof musicFest
    typeName: string
    quantity: number
    daysAgo: number
    checkInCount?: number
    method?: string
  }) {
    const tt = await db.ticketType.findFirstOrThrow({
      where: { eventId: opts.event.id, name: opts.typeName },
    })
    const subtotal = tt.price * opts.quantity
    const platformFee = Math.round(subtotal * 0.03)
    const createdAt = new Date(Date.now() - opts.daysAgo * 24 * 3600 * 1000)
    const order = await db.order.create({
      data: {
        orderNumber: `ORD-${createdAt.getFullYear()}-${crypto.randomInt(100000, 1000000)}`,
        userId: opts.user.id,
        eventId: opts.event.id,
        subtotal,
        platformFee,
        totalAmount: subtotal + platformFee,
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        createdAt,
      },
    })
    await db.payment.create({
      data: {
        orderId: order.id,
        amount: subtotal + platformFee,
        provider: 'SSLCOMMERZ',
        method: opts.method || 'bKash',
        transactionId: `SSL${createdAt.getTime()}${crypto.randomInt(1000, 10000)}`,
        status: 'PAID',
        paidAt: createdAt,
        createdAt,
      },
    })
    const tickets: { id: string }[] = []
    for (let i = 0; i < opts.quantity; i++) {
      tickets.push(
        await db.ticket.create({
          data: {
            orderId: order.id,
            eventId: opts.event.id,
            ticketTypeId: tt.id,
            userId: opts.user.id,
            attendeeName: opts.user.name,
            ticketCode: nextTicketCode(),
            qrToken: nextQrToken(),
            status: 'ACTIVE',
            createdAt,
          },
        })
      )
    }
    // check some in
    const checkInCount = opts.checkInCount ?? 0
    for (let i = 0; i < checkInCount && i < tickets.length; i++) {
      await db.ticket.update({
        where: { id: tickets[i].id },
        data: {
          status: 'CHECKED_IN',
          checkedInAt: new Date(Date.now() - (opts.daysAgo - 12) * 24 * 3600 * 1000),
          checkedInById: staff.id,
        },
      })
    }
    await db.ticketType.update({
      where: { id: tt.id },
      data: { soldQuantity: { increment: opts.quantity } },
    })
    return order
  }

  // main demo customer — VIP ticket on music fest (the portfolio demo ticket)
  await createPaidOrder({
    user: customer,
    event: musicFest,
    typeName: 'VIP',
    quantity: 2,
    daysAgo: 3,
  })
  // main demo customer — tech summit standard
  await createPaidOrder({
    user: customer,
    event: techSummit,
    typeName: 'Standard',
    quantity: 1,
    daysAgo: 6,
  })

  // extra customers to fill analytics
  await createPaidOrder({ user: extraCustomers[0], event: musicFest, typeName: 'VIP', quantity: 2, daysAgo: 8, checkInCount: 1 })
  await createPaidOrder({ user: extraCustomers[1], event: musicFest, typeName: 'General', quantity: 4, daysAgo: 10 })
  await createPaidOrder({ user: extraCustomers[2], event: musicFest, typeName: 'VVIP', quantity: 2, daysAgo: 9, checkInCount: 1 })
  await createPaidOrder({ user: extraCustomers[3], event: musicFest, typeName: 'General', quantity: 3, daysAgo: 7 })
  await createPaidOrder({ user: extraCustomers[4], event: musicFest, typeName: 'VIP', quantity: 1, daysAgo: 5 })
  await createPaidOrder({ user: extraCustomers[5], event: musicFest, typeName: 'General', quantity: 2, daysAgo: 4 })
  await createPaidOrder({ user: extraCustomers[0], event: techSummit, typeName: 'Early Bird', quantity: 1, daysAgo: 12 })
  await createPaidOrder({ user: extraCustomers[1], event: techSummit, typeName: 'Standard', quantity: 2, daysAgo: 11 })
  await createPaidOrder({ user: extraCustomers[2], event: techSummit, typeName: 'VIP Pass', quantity: 1, daysAgo: 9 })
  await createPaidOrder({ user: extraCustomers[3], event: workshop, typeName: 'Professional', quantity: 2, daysAgo: 2 })
  await createPaidOrder({ user: extraCustomers[4], event: workshop, typeName: 'Student', quantity: 1, daysAgo: 1 })
  await createPaidOrder({ user: extraCustomers[5], event: foodFest, typeName: 'Family Pack', quantity: 1, daysAgo: 3 })

  console.log('✅ Seed complete!')
  console.log('   Admin:    admin@ticketbd.com / admin123')
  console.log('   Organizer: organizer@ticketbd.com / organizer123')
  console.log('   Customer: customer@ticketbd.com / customer123')
  console.log('   Staff:    staff@ticketbd.com / staff123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
