import { describe, it, expect } from 'vitest'
import { hslHashForString } from './compareSeasonColors'

describe('compareSeasonColors', () => {
  it('hslHashForString is deterministic', () => {
    expect(hslHashForString('2020-21')).toBe(hslHashForString('2020-21'))
    expect(hslHashForString('2020-21')).not.toBe(hslHashForString('2021-22'))
  })
})
