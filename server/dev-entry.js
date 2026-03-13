import { execFileSync } from 'node:child_process'

const port = String(Number(process.env.PORT || 3135))
const projectRoot = process.cwd()

const readCommandLine = (pid) => {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const readCwd = (pid) => {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
    const cwdLine = output
      .split('\n')
      .find((line) => line.startsWith('n'))
    return cwdLine ? cwdLine.slice(1) : ''
  } catch {
    return ''
  }
}

const listListeningPids = () => {
  try {
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim()
    return output ? output.split('\n').map((item) => Number(item)).filter(Boolean) : []
  } catch {
    return []
  }
}

const stopStaleProjectServer = () => {
  const candidates = listListeningPids().filter((pid) => pid !== process.pid)

  for (const pid of candidates) {
    const command = readCommandLine(pid)
    const cwd = readCwd(pid)
    const isCurrentProjectServer = cwd === projectRoot && command.includes('server/index.js')

    if (!isCurrentProjectServer) {
      throw new Error(`端口 ${port} 已被其他进程占用（PID ${pid}）：${command || '未知命令'}`)
    }

    process.kill(pid, 'SIGTERM')
    console.log(`Stopped stale dev server on port ${port} (PID ${pid}).`)
  }
}

stopStaleProjectServer()

await import('./index.js')
