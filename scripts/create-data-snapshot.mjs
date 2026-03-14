#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { resolveDataDir } from '../server/data-dir.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const sourceDataDir = resolveDataDir({ rootDir: projectRoot })
const sourceDbPath = path.join(sourceDataDir, 'haibao.db')
const destinationArg = process.argv[2]
const destinationDir = destinationArg
  ? path.resolve(process.cwd(), destinationArg)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-data-snapshot-'))

if (!fs.existsSync(sourceDbPath)) {
  console.error(`Database not found: ${sourceDbPath}`)
  process.exit(1)
}

if (destinationDir === sourceDataDir || destinationDir === projectRoot) {
  console.error(`Refusing to write snapshot into unsafe path: ${destinationDir}`)
  process.exit(1)
}

fs.rmSync(destinationDir, { recursive: true, force: true })
fs.mkdirSync(destinationDir, { recursive: true })

const db = new Database(sourceDbPath, { fileMustExist: true })
try {
  await db.backup(path.join(destinationDir, 'haibao.db'))
} finally {
  db.close()
}

for (const directoryName of ['uploads', 'recordings', 'audio-assets']) {
  const sourceDir = path.join(sourceDataDir, directoryName)
  const targetDir = path.join(destinationDir, directoryName)
  fs.mkdirSync(targetDir, { recursive: true })
  if (fs.existsSync(sourceDir)) {
    fs.cpSync(sourceDir, targetDir, { recursive: true })
  }
}

const manifest = {
  createdAt: new Date().toISOString(),
  sourceDataDir,
  included: ['haibao.db', 'uploads', 'recordings', 'audio-assets'],
}

fs.writeFileSync(path.join(destinationDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(destinationDir)
