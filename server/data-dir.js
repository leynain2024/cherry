import path from 'node:path'

export const resolveDataDir = ({ rootDir = process.cwd(), env = process.env } = {}) => {
  const configuredDataDir = String(env.DATA_DIR || '').trim()
  return configuredDataDir ? path.resolve(configuredDataDir) : path.join(rootDir, 'data')
}
