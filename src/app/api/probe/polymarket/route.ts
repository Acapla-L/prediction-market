import { connection, NextResponse } from 'next/server'

interface ProbeResult {
  url: string
  status: number | null
  latencyMs: number | null
  error: string | null
  bodyPreview: string | null
  markets?: number
}

async function probe(url: string, capturePreview = false): Promise<ProbeResult> {
  const started = Date.now()
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'WirePredictions-Probe/1.0 (+https://wirepredictions.vercel.app)',
        'Accept': 'application/json',
      },
    })
    const latencyMs = Date.now() - started

    let bodyPreview: string | null = null
    let markets: number | undefined

    if (capturePreview) {
      const text = await response.text()
      bodyPreview = text.slice(0, 300)
      try {
        const parsed = JSON.parse(text) as unknown
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
          const first = parsed[0] as Record<string, unknown>
          if (Array.isArray(first.markets)) {
            markets = first.markets.length
          }
        }
      }
      catch {
        // ignore parse errors; status is what matters for reachability
      }
    }

    return {
      url,
      status: response.status,
      latencyMs,
      error: null,
      bodyPreview,
      ...(markets !== undefined && { markets }),
    }
  }
  catch (error: unknown) {
    return {
      url,
      status: null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown fetch error',
      bodyPreview: null,
    }
  }
}

export async function GET(): Promise<Response> {
  await connection()
  const vercelRegion = process.env.VERCEL_REGION ?? null
  const vercelEnv = process.env.VERCEL_ENV ?? null

  const [gamma, clob] = await Promise.all([
    probe('https://gamma-api.polymarket.com/events?slug=2026-nba-champion', true),
    probe('https://clob.polymarket.com/prices-history?market=0&interval=1d&fidelity=60', false),
  ])

  const verdict
    = gamma.status === 200 && typeof gamma.markets === 'number' && gamma.markets >= 25
      ? 'pass'
      : 'fail'

  return NextResponse.json({
    probedAt: new Date().toISOString(),
    vercelRegion,
    vercelEnv,
    verdict,
    gamma,
    clob,
  })
}
