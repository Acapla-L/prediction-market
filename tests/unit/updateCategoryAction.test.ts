import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_LOCALES } from '@/i18n/locales'
import { cacheTags } from '@/lib/cache-tags'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  updateTagById: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: any[]) => mocks.revalidatePath(...args),
  updateTag: (...args: any[]) => mocks.updateTag(...args),
}))

vi.mock('@/lib/db/queries/tag', () => ({
  TagRepository: {
    updateTagById: (...args: any[]) => mocks.updateTagById(...args),
  },
}))

vi.mock('@/lib/db/queries/user', () => ({
  UserRepository: {
    getCurrentUser: (...args: any[]) => mocks.getCurrentUser(...args),
  },
}))

const { updateCategoryAction } = await import('@/app/[locale]/admin/categories/_actions/update-category')

describe('updateCategoryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates admin, events list, user events, settings, and per-locale main tag caches after a successful update', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
    mocks.updateTagById.mockResolvedValueOnce({
      data: {
        id: 1,
        name: 'Sports',
        slug: 'sports',
        is_main_category: true,
        is_hidden: false,
        display_order: 1,
        active_markets_count: 10,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-04-23T00:00:00.000Z',
        translations: {},
      },
      error: null,
    })

    const result = await updateCategoryAction(1, { is_hidden: false })

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

    const result = await updateCategoryAction(1, { is_hidden: false })

    expect(result.success).toBe(false)
    expect(mocks.updateTag).toHaveBeenCalledTimes(0)
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(0)
    expect(mocks.updateTagById).toHaveBeenCalledTimes(0)
  })
})
