import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  updateTagTranslationsById: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: any[]) => mocks.revalidatePath(...args),
  updateTag: (...args: any[]) => mocks.updateTag(...args),
}))

vi.mock('@/lib/db/queries/tag', () => ({
  TagRepository: {
    updateTagTranslationsById: (...args: any[]) => mocks.updateTagTranslationsById(...args),
  },
}))

vi.mock('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: (...args: any[]) => mocks.getCurrentUser(...args),
  },
}))

const { updateCategoryTranslationsAction } = await import('@/app/[locale]/admin/categories/_actions/update-category-translations')

describe('updateCategoryTranslationsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates admin, events list, user events, settings, and per-locale main tag caches after a successful translation update', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
    mocks.updateTagTranslationsById.mockResolvedValueOnce({
      data: { de: 'Sport', es: 'Deportes' },
      error: null,
    })

    const result = await updateCategoryTranslationsAction(1, { de: 'Sport', es: 'Deportes' })

    expect(result.success).toBe(true)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]/admin/categories', 'page')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]', 'layout')
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.adminCategories)
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.eventsList)
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.events('admin-1'))
    expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.settings)

    for (const locale of SUPPORTED_LOCALES) {
      expect(mocks.updateTag).toHaveBeenCalledWith(cacheTags.mainTags(locale))
    }
  })

  it('does not invalidate any cache when the caller is not an admin', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)

    const result = await updateCategoryTranslationsAction(1, { de: 'Sport' })

    expect(result.success).toBe(false)
    expect(mocks.updateTag).toHaveBeenCalledTimes(0)
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(0)
    expect(mocks.updateTagTranslationsById).toHaveBeenCalledTimes(0)
  })
})
