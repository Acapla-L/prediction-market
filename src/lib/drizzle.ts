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

  // Connection-pool config (Fix A3 2026-05-11, revised Fix F-3 2026-05-12):
  //   - `max: 10` — the postgres.js / pg default, and what Vercel + Supabase
  //     recommend for serverless functions under Fluid Compute (one instance
  //     serves many concurrent invocations sharing this module-scoped pool;
  //     `max: 1` is an anti-pattern and `max: 5` was too conservative —
  //     ~2-3 concurrent cold page renders saturated it). Supavisor :6543
  //     transaction-pooler cap is 200 clients; 10 × ~4 warm instances = 40,
  //     even a 12-instance bot crawl = 120 — well clear of 200. The original
  //     EMAXCONN trigger (a home-v2 cold render fanning out ~58 simultaneous
  //     checkouts) was fixed by Fix A1's batched team-cache lookup, and the
  //     `revalidatePath('/')` cron thrash was removed, so the small-pool
  //     hardening is no longer load-bearing.
  //     NOTE: postgres.js has NO pool-checkout-wait timeout — a query that
  //     can't get a slot queues until the function dies. `max` is the only
  //     lever here; the real mitigations are reducing cold-render demand
  //     (Fix F-1) and `'use cache: remote'` (follow-up).
  //   - `connection.statement_timeout: 20_000` (20s) makes the per-connection
  //     statement timeout deliberate. A stuck query can't pin a pool slot for
  //     the full Next.js `'use cache'` fill timeout — postgres kills it at 20s
  //     and the slot frees.
  const client = globalForDb.client ?? postgres(url, {
    prepare: false,
    max: 10,
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
