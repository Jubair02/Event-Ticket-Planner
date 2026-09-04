import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Logging every query is useful locally but floods serverless logs in
    // production (and costs latency on each request).
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db