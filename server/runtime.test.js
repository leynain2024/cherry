// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveServerRuntime } from './runtime.js'

describe('resolveServerRuntime', () => {
  it('defaults to https for local compatibility', () => {
    expect(resolveServerRuntime({})).toEqual({
      host: '0.0.0.0',
      logHost: 'localhost',
      port: 3135,
      useHttps: true,
    })
  })

  it('allows production http mode behind nginx', () => {
    expect(
      resolveServerRuntime({
        HOST: '127.0.0.1',
        PORT: '4000',
        SERVER_TLS: 'off',
      }),
    ).toEqual({
      host: '127.0.0.1',
      logHost: '127.0.0.1',
      port: 4000,
      useHttps: false,
    })
  })
})
