import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { SpeakingRecording } from './types'

const buildUsers = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `user-${index + 1}`,
    username: index === 0 ? 'amy' : `user${index + 1}`,
    displayName: index === 0 ? 'Amy' : `学生${index + 1}`,
    subjectId: index % 2 === 0 ? 'subject-haibao-experience' : null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null,
  }))

const buildAppData = (progressOverrides: Record<string, unknown> = {}) => ({
  bootstrapped: true,
  projectSettings: {
    activeAiVendor: 'openai',
    speakingPassScore: 60,
  },
  currentUser: {
    id: 'user-1',
    username: 'amy',
    displayName: 'Amy',
    subjectId: 'subject-haibao-experience',
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null,
  },
  subjects: [
    {
      id: 'subject-haibao-experience',
      name: '海宝体验课',
      description: '测试学科',
      themeColor: '#48a8f6',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'subject-2',
      name: '自然拼读',
      description: '第二学科',
      themeColor: '#48a8f6',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
  ],
  units: [
    {
      id: 'unit-1',
      subjectId: 'subject-haibao-experience',
      title: 'Unit 1',
      source: 'seed',
      stage: 'Stage 1',
      goal: '测试目标',
      difficulty: 'Starter',
      unlockOrder: 1,
      coverEmoji: '📘',
      themeColor: '#48a8f6',
      status: 'published',
      contentOrigin: 'framework',
      sourceImageIds: [],
      rewardRule: {
        starsPerComplete: 2,
        starsPerPerfect: 3,
        unlockAtStars: 8,
        reviewTriggerMistakes: 2,
      },
      vocabulary: [],
      patterns: [],
      reading: {
        id: 'reading-1',
        title: 'Reading',
        content: 'Hello text',
        audioText: 'Hello text',
        question: 'Who is Amy?',
      },
      activities: [
        {
          id: 'activity-warmup',
          title: '热身词卡',
          prompt: '先看看图片，把今天要用到的核心词读熟。',
          skill: 'read',
          kind: 'warmup',
          durationMinutes: 2,
          cards: [
            {
              id: 'card-1',
              word: 'hello',
              phonetic: '/həˈləʊ/',
              meaning: '你好',
              imageLabel: '挥手问好',
              example: 'Hello, I am Amy.',
            },
          ],
        },
        {
          id: 'activity-read',
          title: '阅读理解',
          prompt: '读一读，再回答问题。',
          skill: 'read',
          kind: 'read-choice',
          durationMinutes: 2,
          passage: 'Hello! My name is Amy.',
          question: 'Who is Amy?',
          options: [
            { id: 'a', label: 'Amy', emoji: '⭐' },
            { id: 'b', label: 'Tom', emoji: '⭐' },
          ],
          correctOptionId: 'a',
        },
        {
          id: 'activity-challenge',
          title: '单元挑战',
          prompt: '做做选择题挑战。',
          skill: 'write',
          kind: 'challenge',
          durationMinutes: 2,
          reviewIds: [],
          questions: [
            {
              id: 'question-1',
              prompt: 'Which one is Amy?',
              options: [
                { id: 'a', label: 'Amy' },
                { id: 'b', label: 'Tom' },
              ],
              correctOptionId: 'a',
            },
          ],
        },
      ],
    },
  ],
  progress: {
    childName: 'Amy',
    currentUnitId: 'unit-1',
    totalStars: 0,
    streakDays: 1,
    lastActiveDate: new Date().toISOString().slice(0, 10),
    completedUnitIds: [],
    activityResults: {},
    weakPoints: [],
    ...progressOverrides,
  },
})

describe('Haibao app', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )

    let adminLoggedIn = false
    let userLoggedIn = true
    let currentAppData = buildAppData()
    let recordings: SpeakingRecording[] = []
    let adminUsers = buildUsers(10)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/user/session')) {
          return new Response(
            JSON.stringify({
              authenticated: userLoggedIn,
              user: userLoggedIn ? currentAppData.currentUser : null,
            }),
            { status: 200 },
          )
        }

        if (url.includes('/api/user/login') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body || '{}'))
          if (body.username !== 'amy' || body.password !== 'secret123') {
            return new Response(JSON.stringify({ error: '账号或密码错误' }), { status: 401 })
          }
          userLoggedIn = true
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: currentAppData.currentUser,
            }),
            { status: 200 },
          )
        }

        if (url.includes('/api/user/logout') && init?.method === 'POST') {
          userLoggedIn = false
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }

        if (url.match(/\/api\/admin\/users\/[^/]+\/subject$/) && init?.method === 'POST') {
          const body = JSON.parse(String(init.body || '{}'))
          const userId = url.split('/').at(-2)
          adminUsers = adminUsers.map((user) =>
            user.id === userId
              ? {
                  ...user,
                  subjectId: body.subjectId || null,
                  updatedAt: new Date().toISOString(),
                }
              : user,
          )
          if (currentAppData.currentUser.id === userId) {
            userLoggedIn = false
          }
          return new Response(
            JSON.stringify({
              user: adminUsers.find((user) => user.id === userId),
              forcedLogout: true,
            }),
            { status: 200 },
          )
        }

        if (url.match(/\/api\/admin\/users$/) && init?.method === 'POST') {
          const body = JSON.parse(String(init.body || '{}'))
          if (adminUsers.some((user) => user.username === body.username)) {
            return new Response(
              JSON.stringify({ error: '登录名已存在', code: 'duplicate_username', field: 'username' }),
              { status: 409 },
            )
          }
          const createdUser = {
            id: `user-${adminUsers.length + 1}`,
            username: body.username,
            displayName: body.displayName,
            subjectId: body.subjectId,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLoginAt: null,
          }
          adminUsers = [createdUser, ...adminUsers]
          return new Response(JSON.stringify(createdUser), { status: 201 })
        }

        if (url.match(/\/api\/admin\/users\/[^/]+$/) && init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body || '{}'))
          const userId = url.split('/').pop()
          if (adminUsers.some((user) => user.username === body.username && user.id !== userId)) {
            return new Response(
              JSON.stringify({ error: '登录名已存在', code: 'duplicate_username', field: 'username' }),
              { status: 409 },
            )
          }
          adminUsers = adminUsers.map((user) =>
            user.id === userId
              ? {
                  ...user,
                  username: body.username,
                  displayName: body.displayName,
                  subjectId: user.subjectId,
                  enabled: body.enabled,
                  updatedAt: new Date().toISOString(),
                }
              : user,
          )
          return new Response(JSON.stringify(adminUsers.find((user) => user.id === userId)), { status: 200 })
        }

        if (url.includes('/api/app-data')) {
          if (!userLoggedIn) {
            return new Response(JSON.stringify({ error: '需要先登录学习账号' }), { status: 401 })
          }
          return new Response(JSON.stringify(currentAppData), { status: 200 })
        }

        if (url.includes('/api/user/progress') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body || '{}'))
          currentAppData = {
            ...currentAppData,
            progress: body,
          }
          return new Response(JSON.stringify(currentAppData.progress), { status: 200 })
        }

        if (url.includes('/api/speaking/recordings') && init?.method === 'POST') {
          const recording = {
            id: 'recording-1',
            unitId: 'unit-1',
            activityId: 'activity-speak',
            createdAt: new Date().toISOString(),
            mimeType: 'audio/webm',
            durationSeconds: 3,
            audioUrl: '/api/speaking/recordings/recording-1/audio',
            transcript: '',
            normalizedTranscript: '',
            normalizedTarget: '',
            score: null,
            passed: false,
            feedback: '',
            mistakes: [],
            submittedAt: null,
            errorMessage: '',
          }
          recordings = [recording]
          return new Response(JSON.stringify(recording), { status: 201 })
        }

        if (url.includes('/api/speaking/recordings') && init?.method === 'DELETE') {
          recordings = []
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }

        if (url.includes('/api/speaking/recordings')) {
          return new Response(JSON.stringify(recordings), { status: 200 })
        }

        if (url.includes('/api/speaking/evaluate') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              recordingId: 'recording-1',
              transcript: 'hello world',
              normalizedTranscript: 'hello world',
              normalizedTarget: 'hello world',
              score: 96,
              passed: true,
              feedback: '很好',
              mistakes: [],
            }),
            { status: 200 },
          )
        }

        if (url.includes('/api/admin/login') && init?.method === 'POST') {
          adminLoggedIn = true
          return new Response(JSON.stringify({ ok: true, username: 'admin' }), { status: 200 })
        }

        if (url.includes('/api/admin/logout') && init?.method === 'POST') {
          adminLoggedIn = false
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }

        if (url.includes('/api/admin/state')) {
          return new Response(
            JSON.stringify({
              subjects: currentAppData.subjects.map((subject) => ({
                ...subject,
                images: [],
                units: currentAppData.units.filter((unit) => unit.subjectId === subject.id),
              })),
              drafts: [],
              projectSettings: {
                activeAiVendor: 'openai',
                speakingPassScore: 60,
              },
              providerSettings: [
                {
                  provider: 'openai',
                  apiMode: 'responses',
                  model: 'gpt-5.2',
                  apiKey: '',
                  baseUrl: 'https://api.openai.com/v1',
                  endpoint: '',
                  proxyUrl: '127.0.0.1:7892',
                  reasoningEffort: 'high',
                  verbosity: 'medium',
                  temperature: 0,
                  maxOutputTokens: 2048,
                  speechModel: 'gpt-4o-mini-transcribe',
                  ocrModel: 'gpt-5.2',
                  pricing: {
                    text: {},
                    speech: {},
                    ocr: {},
                  },
                },
              ],
              usageLogs: [],
              users: adminUsers,
            }),
            { status: 200 },
          )
        }

        if (url.includes('/api/settings/project') && init?.method === 'PUT') {
          const body = JSON.parse(String(init.body || '{}'))
          return new Response(JSON.stringify(body), { status: 200 })
        }

        return new Response(
          JSON.stringify({
            bootstrapped: true,
            authenticated: adminLoggedIn,
            username: adminLoggedIn ? 'admin' : null,
          }),
          { status: 200 },
        )
      }),
    )
  })

  it('renders the renamed header and subject for a logged-in user', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝英语闯关岛')).toBeInTheDocument()
      expect(screen.getByText((content) => content.includes('欢迎，Amy'))).toBeInTheDocument()
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })
  })

  it('renders server-provided progress totals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input)
        if (url.includes('/api/user/session')) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: buildAppData({
                totalStars: 9,
                streakDays: 3,
              }).currentUser,
            }),
            { status: 200 },
          )
        }
        if (url.includes('/api/app-data')) {
          return new Response(
            JSON.stringify(
              buildAppData({
                totalStars: 9,
                streakDays: 3,
              }),
            ),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            bootstrapped: true,
            authenticated: false,
            username: null,
          }),
          { status: 200 },
        )
      }),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('9')).toBeInTheDocument()
    })
  })

  it('shows today recommendation progress with completed parts, stars and duration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input)
        const nowIso = new Date().toISOString()
        const today = nowIso.slice(0, 10)
        if (url.includes('/api/user/session')) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: buildAppData({
                activityResults: {
                  'unit-1:activity-warmup': {
                    unitId: 'unit-1',
                    activityId: 'activity-warmup',
                    completed: true,
                    score: 100,
                    durationSeconds: 300,
                    mistakes: [],
                    completedAt: nowIso,
                  },
                },
                dailyStats: {
                  [today]: {
                    date: today,
                    durationSeconds: 600,
                    starsGained: 3,
                    badgesGained: 0,
                  },
                },
              }).currentUser,
            }),
            { status: 200 },
          )
        }
        if (url.includes('/api/app-data')) {
          return new Response(
            JSON.stringify(
              buildAppData({
                activityResults: {
                  'unit-1:activity-warmup': {
                    unitId: 'unit-1',
                    activityId: 'activity-warmup',
                    completed: true,
                    score: 100,
                    durationSeconds: 300,
                    mistakes: [],
                    completedAt: nowIso,
                  },
                },
                dailyStats: {
                  [today]: {
                    date: today,
                    durationSeconds: 600,
                    starsGained: 3,
                    badgesGained: 0,
                  },
                },
              }),
            ),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ bootstrapped: true, authenticated: false, username: null }), { status: 200 })
      }),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('今天已完成 1 个部分')).toBeInTheDocument()
      expect(screen.getByText(/获得 3/)).toBeInTheDocument()
      expect(screen.getByText('学习了 10分钟')).toBeInTheDocument()
    })
  })

  it('submits the admin login form with Enter in the password field', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })
    expect(screen.queryByRole('button', { name: '内容后台' })).not.toBeInTheDocument()
    expect(screen.queryByText('首页只显示登录入口。学习用户登录后进入闯关，管理员登录后进入内容后台。')).not.toBeInTheDocument()

    const username = await screen.findByLabelText('登录名')
    const password = await screen.findByLabelText('密码')

    fireEvent.change(username, { target: { value: 'admin' } })
    fireEvent.change(password, { target: { value: 'secret123' } })
    fireEvent.submit(password.closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByText('后台导航')).toBeInTheDocument()
    })
    expect(screen.queryByText(/当前管理员：/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '退出后台' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '账号登录' })).toBeInTheDocument()
    })
  })

  it('shows the default OpenAI proxy field in model settings', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })
    const username = await screen.findByLabelText('登录名')
    const password = await screen.findByLabelText('密码')

    fireEvent.change(username, { target: { value: 'admin' } })
    fireEvent.change(password, { target: { value: 'secret123' } })
    fireEvent.submit(password.closest('form') as HTMLFormElement)

    const settingsTab = await screen.findByRole('button', { name: '模型设置' })
    fireEvent.click(settingsTab)

    await waitFor(() => {
      expect(screen.getByDisplayValue('127.0.0.1:7892')).toBeInTheDocument()
    })
  })

  it('does not require a learning user when an admin saves project settings', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })

    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.submit(screen.getByLabelText('密码').closest('form') as HTMLFormElement)

    fireEvent.click(await screen.findByRole('button', { name: '模型设置' }))
    const speakingPassLabel = await screen.findByText('口语通过线')
    const speakingPassSelect = speakingPassLabel.closest('label')?.querySelector('select')
    expect(speakingPassSelect).not.toBeNull()
    fireEvent.change(speakingPassSelect as HTMLSelectElement, { target: { value: '65' } })

    await waitFor(() => {
      expect(screen.getByText('已更新项目设置：OpenAI，口语通过线 65 分。')).toBeInTheDocument()
    })
    expect(screen.queryByText('需要先登录学习账号')).not.toBeInTheDocument()
  })

  it('renders an illustration image for warmup vocabulary cards', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Unit 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /^(开始学习|继续学习)$/ }))

    await waitFor(() => {
      expect(screen.getByRole('img', { name: '挥手问好' })).toBeInTheDocument()
    })
  })

  it('keeps choice activities retryable after a wrong answer and finishes on the correct answer', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Unit 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /^(开始学习|继续学习)$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /阅读理解/ }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: '阅读理解' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: '提交答案' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tom/ }))

    expect(screen.queryByText('回答正确，耳朵真灵。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Amy/ })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /Amy/ }))

    await waitFor(() => {
      expect(screen.getByText(/本关得分：/)).toBeInTheDocument()
    })
    expect(screen.getAllByLabelText('阅读理解 3 星').length).toBeGreaterThan(0)
  })

  it('shows paginated users and inline duplicate username feedback in customer management', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })

    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    fireEvent.click(await screen.findByRole('button', { name: '客户管理' }))

    await waitFor(() => {
      expect(screen.getByText('共 10 位用户，第 1 / 2 页')).toBeInTheDocument()
    })
    expect(screen.getByText('user8')).toBeInTheDocument()
    expect(screen.queryByText('学生10')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    await waitFor(() => {
      expect(screen.getByText('共 10 位用户，第 2 / 2 页')).toBeInTheDocument()
    })
    expect(screen.getByText('用户名：学生10')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '新建用户' }))
    await screen.findByRole('dialog', { name: '新建用户' })
    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'amy' } })
    fireEvent.change(screen.getByLabelText('用户姓名'), { target: { value: '重复用户' } })
    fireEvent.change(screen.getByLabelText('当前学科'), { target: { value: 'subject-haibao-experience' } })
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getAllByRole('button', { name: '新建用户' })[1])

    await waitFor(() => {
      expect(screen.getByText('这个登录名已经被占用了，请换一个。')).toBeInTheDocument()
    })
  })

  it('shows a confirmation dialog before deleting a user', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })

    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    fireEvent.click(await screen.findByRole('button', { name: '客户管理' }))
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '确认删除用户' })).toBeInTheDocument()
    })
    expect(screen.getByText(/当前要删除的是/)).toBeInTheDocument()
  })

  it('allows assigning a subject to a user from customer management', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })

    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    fireEvent.click(await screen.findByRole('button', { name: '客户管理' }))
    fireEvent.click(screen.getAllByRole('button', { name: '设置学科' })[0])

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '设置学科' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('当前学科'), { target: { value: 'subject-2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存学科' }))

    await waitFor(() => {
      expect(screen.getByText('用户学科已更新，当前登录会话已强制退出。')).toBeInTheDocument()
    })
  })

  it('strengthens username inputs with english-first mobile hints', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })
    const username = screen.getByLabelText('登录名')
    expect(username).toHaveAttribute('inputmode', 'email')
    expect(username).toHaveAttribute('enterkeyhint', 'next')
    expect(username).toHaveAttribute('pattern', '[A-Za-z0-9._-]*')
  })

  it('requires selecting a subject and supports password visibility toggles for user creation and reset', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('海宝体验课')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出学习账号' }))
    await screen.findByRole('heading', { name: '账号登录' })

    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    fireEvent.click(await screen.findByRole('button', { name: '客户管理' }))
    fireEvent.click(screen.getByRole('button', { name: '新建用户' }))

    const createDialog = await screen.findByRole('dialog', { name: '新建用户' })
    const createPasswordInput = screen.getByLabelText('初始密码')
    expect(createPasswordInput).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: '显示初始密码' }))
    expect(screen.getByLabelText('初始密码')).toHaveAttribute('type', 'text')

    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'ben' } })
    fireEvent.change(screen.getByLabelText('用户姓名'), { target: { value: 'Ben' } })
    fireEvent.change(screen.getByLabelText('当前学科'), { target: { value: 'subject-2' } })
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'secret123' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: '新建用户' }))

    await waitFor(() => {
      expect(screen.getByText('新用户已创建。')).toBeInTheDocument()
    })
    expect(screen.getByText('当前学科：自然拼读')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '重置密码' })[0])
    await screen.findByRole('dialog', { name: '重置密码' })
    expect(screen.getByLabelText('新密码')).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: '显示新密码' }))
    expect(screen.getByLabelText('新密码')).toHaveAttribute('type', 'text')
  })

  it('shows unit stars and medal markers on the home map after a perfect unit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input)
        if (url.includes('/api/user/session')) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: buildAppData({
                activityResults: {
                  'unit-1:activity-warmup': {
                    unitId: 'unit-1',
                    activityId: 'activity-warmup',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                  'unit-1:activity-read': {
                    unitId: 'unit-1',
                    activityId: 'activity-read',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                  'unit-1:activity-challenge': {
                    unitId: 'unit-1',
                    activityId: 'activity-challenge',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                },
              }).currentUser,
            }),
            { status: 200 },
          )
        }
        if (url.includes('/api/app-data')) {
          return new Response(
            JSON.stringify(
              buildAppData({
                activityResults: {
                  'unit-1:activity-warmup': {
                    unitId: 'unit-1',
                    activityId: 'activity-warmup',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                  'unit-1:activity-read': {
                    unitId: 'unit-1',
                    activityId: 'activity-read',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                  'unit-1:activity-challenge': {
                    unitId: 'unit-1',
                    activityId: 'activity-challenge',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                },
              }),
            ),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ bootstrapped: true, authenticated: false, username: null }), { status: 200 })
      }),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('🏅 满星勋章')).toBeInTheDocument()
      expect(screen.getByText('9 / 9')).toBeInTheDocument()
    })
  })

  it('locks a three-star activity and shows the preserved result immediately', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input)
        if (url.includes('/api/user/session')) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: buildAppData({
                activityResults: {
                  'unit-1:activity-read': {
                    unitId: 'unit-1',
                    activityId: 'activity-read',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                },
              }).currentUser,
            }),
            { status: 200 },
          )
        }
        if (url.includes('/api/app-data')) {
          return new Response(
            JSON.stringify(
              buildAppData({
                activityResults: {
                  'unit-1:activity-read': {
                    unitId: 'unit-1',
                    activityId: 'activity-read',
                    completed: true,
                    score: 100,
                    durationSeconds: 30,
                    mistakes: [],
                    completedAt: new Date().toISOString(),
                  },
                },
              }),
            ),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ bootstrapped: true, authenticated: false, username: null }), { status: 200 })
      }),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Unit 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '继续学习' }))
    fireEvent.click(screen.getByRole('button', { name: /阅读理解/ }))

    await waitFor(() => {
      expect(screen.getByText('本关已经满星完成。')).toBeInTheDocument()
    })

    const answerButtons = screen.getAllByRole('button', { name: /Amy|Tom/ })
    answerButtons.forEach((button) => {
      expect(button).toBeDisabled()
    })
  })

  it('locks the unit challenge after it has been completed and shows the final correct options', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input)
        const challengeResult = {
          'unit-1:activity-challenge': {
            unitId: 'unit-1',
            activityId: 'activity-challenge',
            completed: true,
            score: 80,
            durationSeconds: 120,
            mistakes: ['句型复习：Which one is Amy?'],
            completedAt: new Date().toISOString(),
          },
        }
        if (url.includes('/api/user/session')) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: buildAppData({ activityResults: challengeResult }).currentUser,
            }),
            { status: 200 },
          )
        }
        if (url.includes('/api/app-data')) {
          return new Response(JSON.stringify(buildAppData({ activityResults: challengeResult })), { status: 200 })
        }
        return new Response(JSON.stringify({ bootstrapped: true, authenticated: false, username: null }), { status: 200 })
      }),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Unit 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /^(开始学习|继续学习)$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /单元挑战/ }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: '单元挑战' })).toBeInTheDocument()
      expect(screen.getByText('本关已经完成，直接查看最终结果。')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Amy' })).toBeDisabled()
  })
})
