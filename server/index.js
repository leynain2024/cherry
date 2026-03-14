import http from 'node:http'
import https from 'node:https'
import { createApp } from './app.js'
import { ensureLocalHttpsCertificate } from './https-cert.js'
import { resolveServerRuntime } from './runtime.js'

const runtime = resolveServerRuntime(process.env)
const app = createApp({ rootDir: process.cwd() })

if (runtime.useHttps) {
  const httpsOptions = ensureLocalHttpsCertificate(process.cwd())
  https.createServer(httpsOptions, app).listen(runtime.port, runtime.host, () => {
    console.log(`Haibao backend ready on https://${runtime.logHost}:${runtime.port}`)
  })
} else {
  http.createServer(app).listen(runtime.port, runtime.host, () => {
    console.log(`Haibao backend ready on http://${runtime.logHost}:${runtime.port}`)
  })
}
