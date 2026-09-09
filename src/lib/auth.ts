import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { db } from '@/lib/db'

const DEV_FALLBACK_SECRET = 'ticketbd-dev-secret-key-change-in-production'
const MIN_SECRET_LENGTH = 32

let cachedSecret: Uint8Array | null = null

/**
 * HS256 signing key, resolved lazily so a misconfigured deployment fails on the
 * first auth attempt rather than at import time.
 *
 * AUTH_SECRET is REQUIRED in production: falling back to a hardcoded value there
 * would let anyone who has seen this source forge a session for any account,
 * including SUPER_ADMIN.
 */
function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret

  const configured = process.env.AUTH_SECRET?.trim()
  if (configured && configured.length >= MIN_SECRET_LENGTH) {
    cachedSecret = new TextEncoder().encode(configured)
    return cachedSecret
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      configured
        ? `AUTH_SECRET is too short (${configured.length} chars) — use at least ${MIN_SECRET_LENGTH}.`
        : 'AUTH_SECRET is not set. Refusing to sign or verify sessions with the development fallback secret in production.'
    )
  }

  cachedSecret = new TextEncoder().encode(DEV_FALLBACK_SECRET)
  return cachedSecret
}

export const COOKIE_NAME = 'ticketbd_token'

/** Session lifetime in seconds (matches the JWT expiry). */
export const SESSION_MAX_AGE = 7 * 24 * 3600

/**
 * Options for the session cookie, shared by login/register/logout so the flags
 * cannot drift apart.
 *
 * `secure` is on in production so the token is never transmitted over plain
 * HTTP, and off elsewhere so http://localhost still works in development.
 */
export function sessionCookieOptions(maxAge: number = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  }
}

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
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  // Resolved outside the try so a missing AUTH_SECRET surfaces as an error
  // instead of being swallowed as "no valid session".
  const secret = getSecret()
  try {
    const { payload } = await jwtVerify(token, secret)
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

/**
 * Resolves the signed-in organizer's profile.
 *
 * Requires the ORGANIZER role *and* an APPROVED application: an organizer who
 * has not been approved yet has no events and no earnings, and must not reach
 * settlement endpoints.
 */
export async function requireOrganizer() {
  const user = await requireRole('ORGANIZER')
  const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
  if (!organizer) throw new AuthError('Organizer profile not found', 404)
  if (organizer.status !== 'APPROVED') {
    throw new AuthError('Your organizer account is still awaiting approval', 403)
  }
  return { user, organizer }
}
