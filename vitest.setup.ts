import { beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

if (!process.env.REOWN_APPKIT_PROJECT_ID) {
  process.env.REOWN_APPKIT_PROJECT_ID = 'test-appkit'
}

if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = 'https://supabase.test'
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
}

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver
}

// PR 2 (cascade-fix RC-1): module-cache state lives on `globalThis` to
// survive Turbopack HMR / Next.js module re-eval in production. That same
// persistence makes the registry survive `vi.resetModules()` in tests,
// which would otherwise leak cached values across test files. Clearing
// every module cache between tests preserves test isolation.
//
// IMPORTANT: this hook accesses the registry via `globalThis` directly
// instead of importing `__clearAllModuleCachesForTests` from
// `@/lib/db/utils/module-cache`. Importing the module here would evaluate
// it BEFORE any test file's `vi.mock('@sentry/nextjs', ...)` could apply
// — pinning the Sentry binding inside `module-cache.ts`'s closure to the
// real module and breaking the instrumentation-mock assertions in
// `moduleLevelCache.test.ts`. The direct globalThis access pattern keeps
// the module-cache import OUT of setupFiles' evaluation graph so each
// test file's mock hoisting wins.
interface ClearableModuleCache {
  clear: () => void
}

beforeEach(() => {
  const g = globalThis as unknown as {
    __wirepredictions_module_caches?: Map<string, ClearableModuleCache>
  }
  if (g.__wirepredictions_module_caches) {
    for (const cache of g.__wirepredictions_module_caches.values()) {
      cache.clear()
    }
  }
})
