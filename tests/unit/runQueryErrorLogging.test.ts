import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { runQuery } from '@/lib/db/utils/run-query'

describe('runQuery error logging (P0-incident follow-up)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the generic fallback shape unchanged when the query throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runQuery(async () => {
      throw new Error('Failed query: select * from foo where id = $1')
    })

    expect(result).toEqual({ data: null, error: DEFAULT_ERROR_MESSAGE })
  })

  it('logs the original error (SQL/params/code) to console.error before returning the fallback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const originalError = Object.assign(new Error('Failed query: select * from foo where id = $1'), {
      query: 'select * from foo where id = $1',
      params: ['42'],
      code: '57014', // statement timeout
    })

    await runQuery(async () => {
      throw originalError
    })

    expect(errorSpy).toHaveBeenCalled()
    const loggedSomething = errorSpy.mock.calls.some(call => call.includes(originalError))
    expect(loggedSomething).toBe(true)
  })

  it('passes through a successful query result untouched and does not log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runQuery(async () => ({ data: 123, error: null }))

    expect(result).toEqual({ data: 123, error: null })
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
