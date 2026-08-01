import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Production connection pool tuning
    max: 20,                  // max open connections (Postgres default is 100, keep headroom)
    idleTimeoutMillis: 30000, // close idle connections after 30s to free resources
    connectionTimeoutMillis: 5000, // fail fast after 5s if no connection available
    keepAlive: true,          // detect dead connections via TCP keepalive
    keepAliveInitialDelayMillis: 10000,
  })
  const adapter = new PrismaPg(pool as any)
  return new PrismaClient({ adapter })
}

const prismaClient: PrismaClient = globalForPrisma.prisma ?? createPrismaClient()

export const prisma = prismaClient

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaClient
