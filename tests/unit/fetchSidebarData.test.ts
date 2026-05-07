import { describe, expect, test } from 'vitest'
import { shortenTeamName } from '@/app/[locale]/(platform)/home-v2/_data/fetchSidebarData'

describe('shortenTeamName', () => {
  test.each([
    ['New York Yankees', 'Yankees'],
    ['Boston Red Sox', 'Red Sox'],
    ['Chicago White Sox', 'White Sox'],
    ['Toronto Blue Jays', 'Blue Jays'],
    ['Athletics', 'Athletics'],
    ['Padres', 'Padres'],
    ['San Antonio Spurs', 'Spurs'],
    ['Los Angeles Lakers', 'Lakers'],
    ['Sabres', 'Sabres'],
    ['Oklahoma City Thunder', 'Thunder'],
  ])('shortens %s -> %s', (input, expected) => {
    expect(shortenTeamName(input)).toBe(expected)
  })
})
