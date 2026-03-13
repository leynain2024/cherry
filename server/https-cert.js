import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import selfsigned from 'selfsigned'

const ensureDirectory = (targetDir) => {
  fs.mkdirSync(targetDir, { recursive: true })
}

const unique = (items) => Array.from(new Set(items.filter(Boolean)))

const getCertificateHosts = () => {
  const interfaceIps = Object.values(os.networkInterfaces())
    .flat()
    .filter((details) => details && !details.internal)
    .map((details) => details.address)

  return unique([
    'localhost',
    os.hostname(),
    '127.0.0.1',
    '::1',
    ...interfaceIps,
  ])
}

const isIpAddress = (value) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes(':')

const readMetadata = (metadataPath) => {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  } catch {
    return null
  }
}

const writeMetadata = (metadataPath, metadata) => {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
}

const canUseMkcert = () => {
  try {
    execFileSync('mkcert', ['-help'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const generateWithMkcert = ({ keyPath, certPath, hosts }) => {
  execFileSync('mkcert', ['-key-file', keyPath, '-cert-file', certPath, ...hosts], {
    stdio: 'ignore',
  })
}

const generateWithSelfSigned = ({ keyPath, certPath, hosts }) => {
  const attrs = [{ name: 'commonName', value: hosts[0] || 'localhost' }]
  const altNames = hosts.map((host) =>
    isIpAddress(host)
      ? {
          type: 7,
          ip: host,
        }
      : {
          type: 2,
          value: host,
        },
  )

  const pems = selfsigned.generate(attrs, {
    algorithm: 'sha256',
    days: 3650,
    keySize: 2048,
    extensions: [
      {
        name: 'subjectAltName',
        altNames,
      },
    ],
  })

  fs.writeFileSync(keyPath, pems.private, 'utf8')
  fs.writeFileSync(certPath, pems.cert, 'utf8')
}

export const ensureLocalHttpsCertificate = (rootDir = process.cwd()) => {
  const certDir = path.join(rootDir, 'data', 'certs')
  const keyPath = path.join(certDir, 'localhost-key.pem')
  const certPath = path.join(certDir, 'localhost-cert.pem')
  const metadataPath = path.join(certDir, 'localhost-cert.json')
  const hosts = getCertificateHosts()
  const preferredMethod = canUseMkcert() ? 'mkcert' : 'selfsigned'

  ensureDirectory(certDir)

  const metadata = readMetadata(metadataPath)
  const shouldRegenerate =
    !fs.existsSync(keyPath) ||
    !fs.existsSync(certPath) ||
    !metadata ||
    metadata.method !== preferredMethod ||
    JSON.stringify(metadata.hosts || []) !== JSON.stringify(hosts)

  if (shouldRegenerate) {
    try {
      if (preferredMethod === 'mkcert') {
        generateWithMkcert({ keyPath, certPath, hosts })
      } else {
        generateWithSelfSigned({ keyPath, certPath, hosts })
      }
      writeMetadata(metadataPath, {
        method: preferredMethod,
        hosts,
        generatedAt: new Date().toISOString(),
      })
    } catch (error) {
      generateWithSelfSigned({ keyPath, certPath, hosts })
      writeMetadata(metadataPath, {
        method: 'selfsigned',
        hosts,
        generatedAt: new Date().toISOString(),
        fallbackReason: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }
}
