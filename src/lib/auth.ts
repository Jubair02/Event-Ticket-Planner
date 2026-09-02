import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { db } from '@/lib/db'

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'ticketbd-dev-secret-key-change-in-production'
)

export const COOKIE_NAME = 'ticketbd_token'

export type SessionPayload = {
  sub: string
  role: string
}

export async function signToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    if (!payload.sub) return null
    return { sub: payload.sub, role: (payload.role as string) || 'CUSTOMER' }
  } catch {
    return null
  }
}

/** Returns the currently authenticated user row (or null). Server-side only. */
export async function getAuthUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  const session = await verifyToken(token)
  if (!session) return null
  const user = await db.user.findUnique({
    where: { id: session.sub },
    include: {
      organizer: true,
      staffAssignments: {
        include: { event: { select: { id: true, title: true, status: true, startDate: true } } },
      },
    },
  })
  if (!user || user.status !== 'ACTIVE') return null
  return user
}

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.status = status
  }
}

/** Throws AuthError(401) if not authenticated. */
export async function requireAuth() {
  const user = await getAuthUser()
  if (!user) throw new AuthError('You must be signed in to do that', 401)
  return user
}

/** Throws AuthError(403) if role not allowed. */
export async function requireRole(...roles: string[]) {
  const user = await requireAuth()
  if (!roles.includes(user.role)) {
    throw new AuthError('You do not have permission to perform this action', 403)
  }
  return user
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** Generates a unique ticket code like EVT-2026-000123 */
export async function generateTicketCode(): Promise<string> {
  const year = new Date().getFullYear()
  for (let i = 0; i < 25; i++) {
    const n = crypto.randomInt(1, 1000000)
    const code = `EVT-${year}-${String(n).padStart(6, '0')}`
    const existing = await db.ticket.findUnique({ where: { ticketCode: code } })
    if (!existing) return code
  }
  // fallback with timestamp
  return `EVT-${year}-${Date.now().toString().slice(-6)}`
}

/** Generates a unique QR token like qr_a1b2c3... (24 hex chars) */
export async function generateQrToken(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const token = `qr_${crypto.randomBytes(12).toString('hex')}`
    const existing = await db.ticket.findUnique({ where: { qrToken: token } })
    if (!existing) return token
  }
  return `qr_${crypto.randomBytes(16).toString('hex')}`
}

export function generateOrderNumber(): string {
  const year = new Date().getFullYear()
  const rand = crypto.randomInt(100000, 1000000)
  return `ORD-${year}-${rand}`
}

export function generateTransactionId(): string {
  return `SSL${Date.now()}${crypto.randomInt(1000, 10000)}`
}

export function safeUser(user: {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  status: string
  createdAt: Date
  organizer?: { id: string; organizationName: string; status: string } | null
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    organizer: user.organizer
      ? {
          id: user.organizer.id,
          organizationName: user.organizer.organizationName,
          status: user.organizer.status,
        }
      : undefined,
  }
}
