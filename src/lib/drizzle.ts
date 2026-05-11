import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './db/schema'

type DrizzleDb = PostgresJsDatabase<typeof schema>

const globalForDb = globalThis as unknown as {
  client: postgres.Sql | undefined
  db: DrizzleDb | undefined
}

function createDb(): DrizzleDb {
  const url = process.env.POSTGRES_URL
  if (!url) {
    throw new Error('POSTGRES_URL is not set. Configure the database env vars to enable DB features.')
  }

  // Fix A3 (connection-pool hardening 2026-05-11):
  //   - `max: 5` caps each warm Vercel lambda's footprint on the Supabase
  //     Supavisor :6543 transaction pooler. Saturation math = 200 (Supavisor
  //     client cap) / max. With the default `max: 10`, ~20 warm lambdas
  //     saturate the entire pooler; at `max: 5`, ~40 do. Pair with A1+A2
  //     (cold-render fan-out reduction) so per-render query count stays small
  //     enough that an in-instance pool of 5 doesn't itself bottleneck.
  //   - `connection.statement_timeout: '20s'` makes the per-connection 20s
  //     statement timeout deliberate (was previously an incidental
  //     Supavisor/Drizzle default seen in `pg_stat_activity`). A stuck query
  //     can no longer pin a pool slot for the full Next.js 60s `'use cache'`
  //     fill timeout — postgres kills it at 20s and the slot frees.
  const client = globalForDb.client ?? postgres(url, {
    prepare: false,
    max: 5,
    connect_timeout: 10,
    idle_timeout: 20,
    connection: {
      // 20_000 ms = 20s. postgres.js types this as a number (ms); Postgres
      // accepts it as the `statement_timeout` GUC value.
      statement_timeout: 20_000,
    },
  })
  globalForDb.client = client

  const database = globalForDb.db ?? drizzle(client, { schema })
  globalForDb.db = database

  return database
}

function getDb(): DrizzleDb {
  return globalForDb.db ?? createDb()
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    if (prop === 'then') {
      return undefined
    }
    const database = getDb()
    const value = (database as any)[prop]
    return typeof value === 'function' ? value.bind(database) : value
  },
}) as DrizzleDb
