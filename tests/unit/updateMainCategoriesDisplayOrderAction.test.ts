import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  listMainCategoriesForOrdering: vi.fn(),
  updateMainCategoriesDisplayOrder: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: any[]) => mocks.revalidatePath(...args),
  updateTag: (...args: any[]) => mocks.updateTag(...args),
}))

vi.mock('@/lib/db/queries/tag', () => ({
  TagRepository: {
    listMainCategoriesForOrdering: (...args: any[]) => mocks.listMainCategoriesForOrdering(...args),
    updateMainCategoriesDisplayOrder: (...args: any[]) => mocks.updateMainCategoriesDisplayOrder(...args),
  },
}))

vi.mock('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: (...args: any[]) => mocks.getCurrentUser(...args),
  },
}))

const { updateMainCategoriesDisplayOrderAction } = await import('@/app/[locale]/admin/categories/_actions/main-category-order')

describe('updateMainCategoriesDisplayOrderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates admin, events list, user events, settings, and per-locale main tag caches after a successful reorder', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
    mocks.listMainCategoriesForOrdering.mockResolvedValueOnce({
      data: [
        { id: 1, name: 'Sports', slug: 'sports', display_order: 1 },
        { id: 2, name: 'Crypto', slug: 'crypto', display_order: 2 },
        { id: 3, name: 'Finance', slug: 'finance', display_order: 3 },
      ],
      error: null,
    })
    mocks.updateMainCategoriesDisplayOrder.mockResolvedValueOnce({ error: null })

    const result = await updateMainCategoriesDisplayOrderAction([3, 1, 2])

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

    const result = await updateMainCategoriesDisplayOrderAction([1, 2, 3])

    expect(result.success).toBe(false)
    expect(mocks.updateTag).toHaveBeenCalledTimes(0)
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(0)
    expect(mocks.updateMainCategoriesDisplayOrder).toHaveBeenCalledTimes(0)
    expect(mocks.listMainCategoriesForOrdering).toHaveBeenCalledTimes(0)
  })
})
