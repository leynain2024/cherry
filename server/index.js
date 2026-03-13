import https from 'node:https'
import { createApp } from './app.js'
import { ensureLocalHttpsCertificate } from './https-cert.js'

const port = Number(process.env.PORT || 3135)
const app = createApp({ rootDir: process.cwd() })
const httpsOptions = ensureLocalHttpsCertificate(process.cwd())

https.createServer(httpsOptions, app).listen(port, '0.0.0.0', () => {
  console.log(`Haibao backend ready on https://localhost:${port}`)
})
