const DISABLED_TLS_VALUES = new Set(['0', 'false', 'no', 'off'])

export const resolveServerRuntime = (env = process.env) => {
  const rawPort = Number(env.PORT || 3135)
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3135
  const host = String(env.HOST || '0.0.0.0').trim() || '0.0.0.0'
  const tlsValue = String(env.SERVER_TLS || 'on').trim().toLowerCase()
  const useHttps = !DISABLED_TLS_VALUES.has(tlsValue)

  return {
    host,
    logHost: host === '0.0.0.0' ? 'localhost' : host,
    port,
    useHttps,
  }
}
