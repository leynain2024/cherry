// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveDataDir } from './data-dir.js'

describe('resolveDataDir', () => {
  it('uses the project data directory by default', () => {
    expect(resolveDataDir({ rootDir: '/tmp/cherry', env: {} })).toBe('/tmp/cherry/data')
  })

  it('allows a shared data directory outside the app root', () => {
    expect(resolveDataDir({ rootDir: '/tmp/cherry', env: { DATA_DIR: '/opt/cherry-deploy/shared/data' } })).toBe(
      '/opt/cherry-deploy/shared/data',
    )
  })
})
