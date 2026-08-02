import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Resolve a project from inbound lead text without making the report layer
 * depend on fuzzy matching forever. New leads store the resolved foreign key;
 * old records can still be reported through the legacy fallback.
 */
export async function resolveProjectIdForText(
  db: Pick<PrismaClient, 'project'> | Pick<Prisma.TransactionClient, 'project'>,
  values: Array<string | null | undefined>,
): Promise<number | null> {
  const terms = values
    .filter((value): value is string => typeof value === 'string' && value.trim().length >= 3)
    .map(value => value.trim())
  if (terms.length === 0) return null

  const projects = await db.project.findMany({
    select: { id: true, name: true, location: true, city: true },
    orderBy: { name: 'asc' },
  })
  const normalizedTerms = terms.map(term => term.toLowerCase())
  const match = projects.find(project => {
    const haystack = [project.name, project.location, project.city].join(' ').toLowerCase()
    return normalizedTerms.some(term => haystack.includes(term) || term.includes(project.name.toLowerCase()))
  })
  return match?.id ?? null
}
