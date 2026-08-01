/**
 * Keep every Vitest worker on an isolated database. This file runs after
 * dotenv/config and before any application module is imported.
 */
const sourceUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL

if (sourceUrl) {
  const testUrl = new URL(sourceUrl)
  if (!process.env.TEST_DATABASE_URL) testUrl.pathname = '/realzentic_dubai_test'

  const databaseName = testUrl.pathname.replace(/^\//, '')
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Vitest refused unsafe database "${databaseName}"; use a database ending in _test`)
  }

  process.env.DATABASE_URL = testUrl.toString()
}
