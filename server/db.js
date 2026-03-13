import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { buildFrameworkUnits, defaultSubject } from './framework-content.js'
import { normalizePricing } from './pricing.js'

const now = () => new Date().toISOString()

const serializeJson = (value) => JSON.stringify(value ?? null)
const parseJson = (value, fallback) => {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const openAiDefaults = {
  apiMode: 'responses',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.2',
  reasoningEffort: 'high',
  verbosity: 'medium',
  maxOutputTokens: 2048,
  speechModel: 'gpt-4o-mini-transcribe',
  ocrModel: 'gpt-5.2',
  proxyUrl: '127.0.0.1:7892',
}

const openAiModelOptions = ['gpt-5.2', 'gpt-5.4']
const openAiReasoningOptions = ['none', 'low', 'medium', 'high', 'xhigh']
const openAiVerbosityOptions = ['low', 'medium', 'high']
const openAiSpeechModelOptions = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe']
const openAiMaxOutputTokenOptions = [512, 1024, 2048, 4096, 8192, 16384]

const qwenDefaults = {
  apiMode: 'native',
  model: 'qwen-plus',
  apiKey: '',
  baseUrl: 'https://dashscope.aliyuncs.com',
  endpoint: '',
  temperature: 0.2,
  maxOutputTokens: 2048,
  speechModel: 'qwen3-asr-flash',
}

const qwenApiModeOptions = ['native', 'compatible']
const qwenModelOptions = ['qwen-turbo', 'qwen-plus', 'qwen-max']
const qwenTemperatureOptions = [0, 0.2, 0.5, 0.8, 1]
const qwenMaxTokenOptions = [512, 1024, 2048, 4096]
const qwenSpeechModelOptions = ['qwen3-asr-flash', 'qwen-audio-turbo']

const aliyunOcrDefaults = {
  apiMode: 'sdk',
  model: 'RecognizeAllText',
  endpoint: 'ocr-api.cn-hangzhou.aliyuncs.com',
  regionId: 'cn-hangzhou',
  ocrType: 'Advanced',
}

const aliyunRegionOptions = ['cn-hangzhou']
const aliyunOcrTypeOptions = ['Advanced']
const speakingPassScoreOptions = [60, 65, 70, 75]
const projectSettingsDefaults = {
  activeAiVendor: 'openai',
  speakingPassScore: 60,
}

const normalizeProjectSettings = (input = {}) => ({
  activeAiVendor: input.activeAiVendor === 'aliyun' ? 'aliyun' : 'openai',
  speakingPassScore: speakingPassScoreOptions.includes(Number(input.speakingPassScore)) ? Number(input.speakingPassScore) : 60,
})

const getScoreStars = (score, speakingPassScore) => {
  if (score === 100) {
    return 3
  }
  if (score >= 80) {
    return 2
  }
  if (score >= speakingPassScore) {
    return 1
  }
  return 0
}

const normalizeOpenAIProviderInput = (input = {}) => {
  const extra = input.extra || {}
  const model = openAiModelOptions.includes(input.model) ? input.model : openAiDefaults.model
  const reasoningEffort = openAiReasoningOptions.includes(input.reasoningEffort)
    ? input.reasoningEffort
    : openAiDefaults.reasoningEffort
  const verbosity = openAiVerbosityOptions.includes(extra.verbosity) ? extra.verbosity : openAiDefaults.verbosity
  const maxOutputTokens = openAiMaxOutputTokenOptions.includes(Number(input.maxOutputTokens))
    ? Number(input.maxOutputTokens)
    : openAiDefaults.maxOutputTokens
  const speechModel = openAiSpeechModelOptions.includes(extra.speechModel) ? extra.speechModel : openAiDefaults.speechModel
  const ocrModel = openAiModelOptions.includes(extra.ocrModel) ? extra.ocrModel : openAiDefaults.ocrModel
  const proxyUrl =
    typeof extra.proxyUrl === 'string' && extra.proxyUrl.trim() ? extra.proxyUrl.trim() : openAiDefaults.proxyUrl

  return {
    apiMode: openAiDefaults.apiMode,
    model,
    apiKey: input.apiKey || '',
    baseUrl: openAiDefaults.baseUrl,
    endpoint: '',
    reasoningEffort,
    temperature: 0,
    maxOutputTokens,
    extra: {
      verbosity,
      speechModel,
      ocrModel,
      proxyUrl,
    },
    pricing: normalizePricing(input.pricing),
  }
}

const normalizeQwenProviderInput = (input = {}) => {
  const extra = input.extra || {}
  return {
    apiMode: qwenApiModeOptions.includes(input.apiMode) ? input.apiMode : qwenDefaults.apiMode,
    model: qwenModelOptions.includes(input.model) ? input.model : qwenDefaults.model,
    apiKey: input.apiKey || '',
    baseUrl: qwenDefaults.baseUrl,
    endpoint: input.endpoint || '',
    reasoningEffort: '',
    temperature: qwenTemperatureOptions.includes(Number(input.temperature)) ? Number(input.temperature) : qwenDefaults.temperature,
    maxOutputTokens: qwenMaxTokenOptions.includes(Number(input.maxOutputTokens))
      ? Number(input.maxOutputTokens)
      : qwenDefaults.maxOutputTokens,
    extra: {
      speechModel: qwenSpeechModelOptions.includes(extra.speechModel) ? extra.speechModel : qwenDefaults.speechModel,
    },
    pricing: normalizePricing(input.pricing),
  }
}

const normalizeAliyunOcrProviderInput = (input = {}) => {
  const extra = input.extra || {}
  return {
    apiMode: aliyunOcrDefaults.apiMode,
    model: aliyunOcrDefaults.model,
    apiKey: '',
    baseUrl: '',
    endpoint: input.endpoint || aliyunOcrDefaults.endpoint,
    reasoningEffort: '',
    temperature: 0,
    maxOutputTokens: 0,
    extra: {
      accessKeyId: extra.accessKeyId || '',
      accessKeySecret: extra.accessKeySecret || '',
      regionId: aliyunRegionOptions.includes(extra.regionId) ? extra.regionId : aliyunOcrDefaults.regionId,
      ocrType: aliyunOcrTypeOptions.includes(extra.ocrType) ? extra.ocrType : aliyunOcrDefaults.ocrType,
    },
    pricing: normalizePricing(input.pricing),
  }
}

const normalizeProviderInput = (provider, input = {}) => {
  if (provider === 'openai') {
    return normalizeOpenAIProviderInput(input)
  }
  if (provider === 'qwen') {
    return normalizeQwenProviderInput(input)
  }

  return normalizeAliyunOcrProviderInput(input)
}

const unitRowToObject = (row) => ({
  id: row.id,
  subjectId: row.subject_id,
  title: row.title,
  source: row.source,
  stage: row.stage,
  goal: row.goal,
  difficulty: row.difficulty,
  unlockOrder: row.unlock_order,
  coverEmoji: row.cover_emoji,
  themeColor: row.theme_color,
  status: row.status,
  contentOrigin: row.content_origin,
  sourceImageIds: parseJson(row.source_image_ids, []),
  rewardRule: parseJson(row.reward_rule_json, {}),
  vocabulary: parseJson(row.vocabulary_json, []),
  patterns: parseJson(row.patterns_json, []),
  reading: parseJson(row.reading_json, {}),
  activities: parseJson(row.activities_json, []),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const userRowToObject = (row) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  subjectId: row.subject_id || null,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastLoginAt: row.last_login_at,
})

const progressRowToActivityResult = (row) => ({
  unitId: row.unit_id,
  activityId: row.activity_id,
  completed: row.completed === 1,
  score: row.score,
  durationSeconds: row.duration_seconds,
  mistakes: parseJson(row.mistakes_json, []),
  completedAt: row.completed_at,
})

const speakingRecordingRowToObject = (row) => ({
  id: row.id,
  unitId: row.unit_id,
  activityId: row.activity_id,
  createdAt: row.created_at,
  mimeType: row.mime_type,
  durationSeconds: row.duration_seconds || 0,
  audioUrl: `/api/speaking/recordings/${row.id}/audio`,
  transcript: row.transcript || '',
  normalizedTranscript: row.normalized_transcript || '',
  normalizedTarget: row.normalized_target || '',
  score: row.score === null || row.score === undefined ? null : row.score,
  passed: row.passed === 1,
  feedback: row.feedback || '',
  mistakes: parseJson(row.mistakes_json, []),
  submittedAt: row.submitted_at,
  errorMessage: row.error_message || '',
})

export const createDataStore = ({ rootDir = process.cwd() } = {}) => {
  const dataDir = path.join(rootDir, 'data')
  const uploadsDir = path.join(dataDir, 'uploads')
  const recordingsDir = path.join(dataDir, 'recordings')
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.mkdirSync(recordingsDir, { recursive: true })

  const db = new Database(path.join(dataDir, 'haibao.db'))
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      subject_id TEXT,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      current_unit_id TEXT,
      total_stars INTEGER NOT NULL DEFAULT 0,
      streak_days INTEGER NOT NULL DEFAULT 1,
      last_active_date TEXT,
      completed_unit_ids_json TEXT NOT NULL DEFAULT '[]',
      weak_points_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_activity_progress (
      user_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      completed INTEGER NOT NULL,
      score INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL,
      mistakes_json TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, unit_id, activity_id)
    );
    CREATE TABLE IF NOT EXISTS speaking_recordings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      transcript TEXT,
      normalized_transcript TEXT,
      normalized_target TEXT,
      score INTEGER,
      passed INTEGER NOT NULL DEFAULT 0,
      feedback TEXT,
      mistakes_json TEXT NOT NULL DEFAULT '[]',
      submitted_at TEXT,
      error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      theme_color TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      stage TEXT NOT NULL,
      goal TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      unlock_order INTEGER NOT NULL,
      cover_emoji TEXT NOT NULL,
      theme_color TEXT NOT NULL,
      status TEXT NOT NULL,
      content_origin TEXT NOT NULL,
      source_image_ids TEXT NOT NULL,
      reward_rule_json TEXT NOT NULL,
      vocabulary_json TEXT NOT NULL,
      patterns_json TEXT NOT NULL,
      reading_json TEXT NOT NULL,
      activities_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subject_images (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      page_label TEXT
    );
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      image_ids TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      draft_unit_id TEXT,
      ocr_text TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_settings (
      provider TEXT PRIMARY KEY,
      api_mode TEXT,
      model TEXT,
      api_key TEXT,
      base_url TEXT,
      endpoint TEXT,
      reasoning_effort TEXT,
      temperature REAL,
      max_output_tokens INTEGER,
      extra_json TEXT NOT NULL,
      pricing_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      subject_id TEXT,
      feature TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      estimated_cost REAL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      job_id TEXT,
      details_json TEXT NOT NULL
    );
  `)

  const userColumns = db.prepare('PRAGMA table_info(users)').all()
  if (!userColumns.some((column) => column.name === 'subject_id')) {
    db.exec('ALTER TABLE users ADD COLUMN subject_id TEXT')
  }

  const providerDefaults = [
    {
      provider: 'openai',
      apiMode: openAiDefaults.apiMode,
      model: openAiDefaults.model,
      apiKey: '',
      baseUrl: openAiDefaults.baseUrl,
      endpoint: '',
      reasoningEffort: openAiDefaults.reasoningEffort,
      temperature: 0,
      maxOutputTokens: openAiDefaults.maxOutputTokens,
      extra: {
        verbosity: openAiDefaults.verbosity,
        speechModel: openAiDefaults.speechModel,
        ocrModel: openAiDefaults.ocrModel,
        proxyUrl: openAiDefaults.proxyUrl,
      },
      pricing: normalizePricing({}),
    },
    {
      provider: 'qwen',
      apiMode: qwenDefaults.apiMode,
      model: qwenDefaults.model,
      apiKey: '',
      baseUrl: qwenDefaults.baseUrl,
      endpoint: '',
      reasoningEffort: '',
      temperature: qwenDefaults.temperature,
      maxOutputTokens: qwenDefaults.maxOutputTokens,
      extra: {
        speechModel: qwenDefaults.speechModel,
      },
      pricing: normalizePricing({}),
    },
    {
      provider: 'aliyun-ocr',
      apiMode: aliyunOcrDefaults.apiMode,
      model: aliyunOcrDefaults.model,
      apiKey: '',
      baseUrl: '',
      endpoint: aliyunOcrDefaults.endpoint,
      reasoningEffort: '',
      temperature: 0,
      maxOutputTokens: 0,
      extra: {
        accessKeyId: '',
        accessKeySecret: '',
        regionId: aliyunOcrDefaults.regionId,
        ocrType: aliyunOcrDefaults.ocrType,
      },
      pricing: normalizePricing({}),
    },
  ]

  const insertProvider = db.prepare(`
    INSERT OR IGNORE INTO provider_settings
    (provider, api_mode, model, api_key, base_url, endpoint, reasoning_effort, temperature, max_output_tokens, extra_json, pricing_json, updated_at)
    VALUES
    (@provider, @apiMode, @model, @apiKey, @baseUrl, @endpoint, @reasoningEffort, @temperature, @maxOutputTokens, @extraJson, @pricingJson, @updatedAt)
  `)

  providerDefaults.forEach((setting) => {
    insertProvider.run({
      ...setting,
      extraJson: serializeJson(setting.extra),
      pricingJson: serializeJson(setting.pricing),
      updatedAt: now(),
    })
  })

  db.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
  `).run('project_settings', serializeJson(projectSettingsDefaults), now())

  const subjectCount = db.prepare('SELECT COUNT(*) AS count FROM subjects').get().count
  if (!subjectCount) {
    db.prepare(`
      INSERT INTO subjects (id, name, description, theme_color, status, created_at)
      VALUES (@id, @name, @description, @themeColor, @status, @createdAt)
    `).run({
      ...defaultSubject,
      themeColor: defaultSubject.themeColor,
    })

    const insertUnit = db.prepare(`
      INSERT INTO units
      (id, subject_id, title, source, stage, goal, difficulty, unlock_order, cover_emoji, theme_color, status, content_origin, source_image_ids, reward_rule_json, vocabulary_json, patterns_json, reading_json, activities_json, created_at, updated_at)
      VALUES
      (@id, @subjectId, @title, @source, @stage, @goal, @difficulty, @unlockOrder, @coverEmoji, @themeColor, @status, @contentOrigin, @sourceImageIds, @rewardRuleJson, @vocabularyJson, @patternsJson, @readingJson, @activitiesJson, @createdAt, @updatedAt)
    `)

    buildFrameworkUnits(defaultSubject.id).forEach((unit) => {
      insertUnit.run({
        id: unit.id,
        subjectId: unit.subjectId,
        title: unit.title,
        source: unit.source,
        stage: unit.stage,
        goal: unit.goal,
        difficulty: unit.difficulty,
        unlockOrder: unit.unlockOrder,
        coverEmoji: unit.coverEmoji,
        themeColor: unit.themeColor,
        status: unit.status,
        contentOrigin: unit.contentOrigin,
        sourceImageIds: serializeJson(unit.sourceImageIds),
        rewardRuleJson: serializeJson(unit.rewardRule),
        vocabularyJson: serializeJson(unit.vocabulary),
        patternsJson: serializeJson(unit.patterns),
        readingJson: serializeJson(unit.reading),
        activitiesJson: serializeJson(unit.activities),
        createdAt: now(),
        updatedAt: now(),
      })
    })
  }

  const listUnitsByStatus = db.prepare('SELECT * FROM units WHERE status = ? ORDER BY unlock_order ASC')
  const listAllUnits = db.prepare('SELECT * FROM units ORDER BY status DESC, unlock_order ASC, created_at DESC')
  const listSubjects = db.prepare('SELECT * FROM subjects ORDER BY created_at ASC')
  const listImagesBySubject = db.prepare('SELECT * FROM subject_images WHERE subject_id = ? ORDER BY uploaded_at DESC')
  const findSubject = db.prepare('SELECT * FROM subjects WHERE id = ?')
  const findUnit = db.prepare('SELECT * FROM units WHERE id = ?')
  const findUserById = db.prepare('SELECT * FROM users WHERE id = ?')
  const findUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?')
  const listUsersStmt = db.prepare('SELECT * FROM users ORDER BY created_at DESC')
  const findUserProfile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?')
  const listUserActivityProgress = db.prepare('SELECT * FROM user_activity_progress WHERE user_id = ?')
  const deleteUserActivityProgress = db.prepare('DELETE FROM user_activity_progress WHERE user_id = ?')
  const upsertUserProfile = db.prepare(`
    INSERT INTO user_profiles
    (user_id, current_unit_id, total_stars, streak_days, last_active_date, completed_unit_ids_json, weak_points_json, updated_at)
    VALUES
    (@userId, @currentUnitId, @totalStars, @streakDays, @lastActiveDate, @completedUnitIdsJson, @weakPointsJson, @updatedAt)
    ON CONFLICT(user_id) DO UPDATE SET
      current_unit_id = excluded.current_unit_id,
      total_stars = excluded.total_stars,
      streak_days = excluded.streak_days,
      last_active_date = excluded.last_active_date,
      completed_unit_ids_json = excluded.completed_unit_ids_json,
      weak_points_json = excluded.weak_points_json,
      updated_at = excluded.updated_at
  `)
  const insertUserActivityProgress = db.prepare(`
    INSERT INTO user_activity_progress
    (user_id, unit_id, activity_id, completed, score, duration_seconds, mistakes_json, completed_at)
    VALUES
    (@userId, @unitId, @activityId, @completed, @score, @durationSeconds, @mistakesJson, @completedAt)
  `)
  const listSpeakingRecordingsStmt = db.prepare(`
    SELECT * FROM speaking_recordings
    WHERE user_id = ? AND unit_id = ? AND activity_id = ?
    ORDER BY created_at DESC
  `)
  const findSpeakingRecordingStmt = db.prepare('SELECT * FROM speaking_recordings WHERE id = ? AND user_id = ?')
  const deleteSpeakingRecordingStmt = db.prepare('DELETE FROM speaking_recordings WHERE id = ? AND user_id = ?')
  const updateUnitStmt = db.prepare(`
    UPDATE units
    SET title = @title,
        source = @source,
        stage = @stage,
        goal = @goal,
        difficulty = @difficulty,
        unlock_order = @unlockOrder,
        cover_emoji = @coverEmoji,
        theme_color = @themeColor,
        status = @status,
        content_origin = @contentOrigin,
        source_image_ids = @sourceImageIds,
        reward_rule_json = @rewardRuleJson,
        vocabulary_json = @vocabularyJson,
        patterns_json = @patternsJson,
        reading_json = @readingJson,
        activities_json = @activitiesJson,
        updated_at = @updatedAt
    WHERE id = @id
  `)
  const insertUnitStmt = db.prepare(`
    INSERT INTO units
    (id, subject_id, title, source, stage, goal, difficulty, unlock_order, cover_emoji, theme_color, status, content_origin, source_image_ids, reward_rule_json, vocabulary_json, patterns_json, reading_json, activities_json, created_at, updated_at)
    VALUES
    (@id, @subjectId, @title, @source, @stage, @goal, @difficulty, @unlockOrder, @coverEmoji, @themeColor, @status, @contentOrigin, @sourceImageIds, @rewardRuleJson, @vocabularyJson, @patternsJson, @readingJson, @activitiesJson, @createdAt, @updatedAt)
  `)

  const normalizeProviderSetting = (row) => ({
    provider: row.provider,
    apiMode: row.api_mode,
    model: row.model,
    apiKey: row.api_key,
    baseUrl: row.base_url,
    endpoint: row.endpoint,
    reasoningEffort: row.reasoning_effort,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    ...parseJson(row.extra_json, {}),
    pricing: normalizePricing(parseJson(row.pricing_json, {})),
    updatedAt: row.updated_at,
  })

  const getProjectSettings = () => {
    const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('project_settings')
    return normalizeProjectSettings({
      ...projectSettingsDefaults,
      ...parseJson(row?.value_json, projectSettingsDefaults),
    })
  }

  const buildUserProgress = (userId, subjectId = null) => {
    const user = findUserById.get(userId)
    const speakingPassScore = getProjectSettings().speakingPassScore
    const publishedUnits = listUnitsByStatus
      .all('published')
      .map(unitRowToObject)
      .filter((unit) => !subjectId || unit.subjectId === subjectId)
    const publishedUnitIds = new Set(publishedUnits.map((unit) => unit.id))
    const profile = findUserProfile.get(userId)
    const activityRows = listUserActivityProgress
      .all(userId)
      .filter((row) => !subjectId || publishedUnitIds.has(row.unit_id))
    const activityResults = activityRows.reduce((acc, row) => {
      acc[`${row.unit_id}:${row.activity_id}`] = progressRowToActivityResult(row)
      return acc
    }, {})
    const completedUnitIds = parseJson(profile?.completed_unit_ids_json, []).filter(
      (unitId) => !subjectId || publishedUnitIds.has(unitId),
    )
    const totalStars = activityRows.reduce((sum, row) => {
      if (!row.completed) {
        return sum
      }
      return sum + getScoreStars(row.score, speakingPassScore)
    }, 0)
    const currentUnitId =
      profile?.current_unit_id && publishedUnitIds.has(profile.current_unit_id) ? profile.current_unit_id : publishedUnits[0]?.id || ''

    return {
      childName: user?.display_name || '海宝同学',
      currentUnitId,
      totalStars,
      streakDays: profile?.streak_days || 1,
      lastActiveDate: profile?.last_active_date || now().slice(0, 10),
      completedUnitIds,
      activityResults,
      weakPoints: parseJson(profile?.weak_points_json, []),
    }
  }

  const saveUserProgressSnapshot = db.transaction((userId, progress) => {
    upsertUserProfile.run({
      userId,
      currentUnitId: progress.currentUnitId || '',
      totalStars: progress.totalStars || 0,
      streakDays: progress.streakDays || 1,
      lastActiveDate: progress.lastActiveDate || now().slice(0, 10),
      completedUnitIdsJson: serializeJson(progress.completedUnitIds || []),
      weakPointsJson: serializeJson(progress.weakPoints || []),
      updatedAt: now(),
    })

    deleteUserActivityProgress.run(userId)

    Object.values(progress.activityResults || {}).forEach((result) => {
      insertUserActivityProgress.run({
        userId,
        unitId: result.unitId,
        activityId: result.activityId,
        completed: result.completed ? 1 : 0,
        score: result.score || 0,
        durationSeconds: result.durationSeconds || 0,
        mistakesJson: serializeJson(result.mistakes || []),
        completedAt: result.completedAt || now(),
      })
    })
  })

  return {
    uploadsDir,
    recordingsDir,
    isBootstrapped() {
      return db.prepare('SELECT COUNT(*) AS count FROM admin_users').get().count > 0
    },
    createAdminUser(username, password) {
      const createdAt = now()
      const passwordHash = bcrypt.hashSync(password, 10)
      db.prepare(`
        INSERT INTO admin_users (id, username, password_hash, created_at)
        VALUES (@id, @username, @passwordHash, @createdAt)
      `).run({
        id: randomUUID(),
        username,
        passwordHash,
        createdAt,
      })
    },
    verifyAdminUser(username, password) {
      const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username)
      if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
        return null
      }

      db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(now(), admin.id)
      return admin
    },
    changeAdminPassword(adminId, currentPassword, nextPassword) {
      const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId)
      if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
        return false
      }

      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nextPassword, 10), adminId)
      return true
    },
    createSession(adminId) {
      const token = createHash('sha256').update(`${adminId}:${randomUUID()}:${Date.now()}`).digest('hex')
      const createdAt = now()
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      db.prepare('INSERT INTO sessions (token, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        token,
        adminId,
        createdAt,
        expiresAt,
      )
      return { token, expiresAt }
    },
    getSession(token) {
      if (!token) {
        return null
      }

      const row = db
        .prepare(`
          SELECT sessions.token, sessions.expires_at, admin_users.id AS admin_id, admin_users.username
          FROM sessions
          JOIN admin_users ON admin_users.id = sessions.admin_id
          WHERE sessions.token = ?
        `)
        .get(token)
      if (!row) {
        return null
      }

      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
        return null
      }

      return row
    },
    deleteSession(token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    },
    createUser({ username, displayName, password, subjectId }) {
      const user = {
        id: `user-${randomUUID()}`,
        username,
        displayName,
        subjectId,
        passwordHash: bcrypt.hashSync(password, 10),
        enabled: 1,
        createdAt: now(),
        updatedAt: now(),
      }
      db.prepare(`
        INSERT INTO users (id, username, display_name, subject_id, password_hash, enabled, created_at, updated_at)
        VALUES (@id, @username, @displayName, @subjectId, @passwordHash, @enabled, @createdAt, @updatedAt)
      `).run(user)
      upsertUserProfile.run({
        userId: user.id,
        currentUnitId: '',
        totalStars: 0,
        streakDays: 1,
        lastActiveDate: now().slice(0, 10),
        completedUnitIdsJson: '[]',
        weakPointsJson: '[]',
        updatedAt: now(),
      })
      return userRowToObject(findUserById.get(user.id))
    },
    listUsers() {
      return listUsersStmt.all().map(userRowToObject)
    },
    updateUser(userId, { username, displayName, enabled }) {
      const existing = findUserById.get(userId)
      if (!existing) {
        return null
      }

      db.prepare(`
        UPDATE users
        SET username = ?,
            display_name = ?,
            enabled = ?,
            updated_at = ?
        WHERE id = ?
      `).run(username, displayName, enabled ? 1 : 0, now(), userId)
      return userRowToObject(findUserById.get(userId))
    },
    assignUserSubject(userId, subjectId) {
      const existing = findUserById.get(userId)
      if (!existing) {
        return null
      }

      const normalizedSubjectId = subjectId || null
      const forcedLogout = (existing.subject_id || null) !== normalizedSubjectId
      db.prepare('UPDATE users SET subject_id = ?, updated_at = ? WHERE id = ?').run(normalizedSubjectId, now(), userId)
      if (forcedLogout) {
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId)
      }

      return {
        user: userRowToObject(findUserById.get(userId)),
        forcedLogout,
      }
    },
    resetUserPassword(userId, newPassword) {
      const existing = findUserById.get(userId)
      if (!existing) {
        return false
      }

      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        bcrypt.hashSync(newPassword, 10),
        now(),
        userId,
      )
      return true
    },
    deleteUser(userId) {
      const recordings = db.prepare('SELECT file_path FROM speaking_recordings WHERE user_id = ?').all(userId)
      recordings.forEach((recording) => {
        if (recording.file_path && fs.existsSync(recording.file_path)) {
          fs.rmSync(recording.file_path, { force: true })
        }
      })

      db.prepare('DELETE FROM speaking_recordings WHERE user_id = ?').run(userId)
      db.prepare('DELETE FROM user_activity_progress WHERE user_id = ?').run(userId)
      db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(userId)
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId)
      return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0
    },
    verifyUser(username, password) {
      const user = findUserByUsername.get(username)
      if (!user || user.enabled !== 1 || !bcrypt.compareSync(password, user.password_hash)) {
        return null
      }

      db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), user.id)
      return userRowToObject(findUserById.get(user.id))
    },
    createUserSession(userId) {
      const token = createHash('sha256').update(`user:${userId}:${randomUUID()}:${Date.now()}`).digest('hex')
      const createdAt = now()
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        token,
        userId,
        createdAt,
        expiresAt,
      )
      return { token, expiresAt }
    },
    getUserSession(token) {
      if (!token) {
        return null
      }

      const row = db
        .prepare(`
          SELECT user_sessions.token, user_sessions.expires_at, users.*
          FROM user_sessions
          JOIN users ON users.id = user_sessions.user_id
          WHERE user_sessions.token = ?
        `)
        .get(token)
      if (!row) {
        return null
      }

      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token)
        return null
      }

      if (row.enabled !== 1) {
        db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token)
        return null
      }

      return {
        token: row.token,
        expiresAt: row.expires_at,
        user: userRowToObject(row),
      }
    },
    deleteUserSession(token) {
      db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token)
    },
    getAppData(userId) {
      const currentUser = userRowToObject(findUserById.get(userId))
      const scopedSubjects = listSubjects
        .all()
        .filter((subject) => !currentUser.subjectId || subject.id === currentUser.subjectId)
      const subjects = scopedSubjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        description: subject.description,
        themeColor: subject.theme_color,
        status: subject.status,
        createdAt: subject.created_at,
      }))
      const publishedUnits = listUnitsByStatus
        .all('published')
        .map(unitRowToObject)
        .filter((unit) => !currentUser.subjectId || unit.subjectId === currentUser.subjectId)
      return {
        subjects,
        units: publishedUnits,
        projectSettings: getProjectSettings(),
        progress: buildUserProgress(userId, currentUser.subjectId),
        currentUser,
      }
    },
    getUserProgress(userId) {
      const currentUser = userRowToObject(findUserById.get(userId))
      return buildUserProgress(userId, currentUser.subjectId)
    },
    saveUserProgress(userId, progress) {
      saveUserProgressSnapshot(userId, progress)
      const currentUser = userRowToObject(findUserById.get(userId))
      return buildUserProgress(userId, currentUser.subjectId)
    },
    getPublicAppData() {
      const subjects = listSubjects.all().map((subject) => ({
        id: subject.id,
        name: subject.name,
        description: subject.description,
        themeColor: subject.theme_color,
        status: subject.status,
        createdAt: subject.created_at,
      }))
      const publishedUnits = listUnitsByStatus.all('published').map(unitRowToObject)
      return { subjects, units: publishedUnits }
    },
    getAdminState() {
      const subjects = listSubjects.all().map((subject) => ({
        id: subject.id,
        name: subject.name,
        description: subject.description,
        themeColor: subject.theme_color,
        status: subject.status,
        createdAt: subject.created_at,
        images: listImagesBySubject.all(subject.id).map((image) => ({
          id: image.id,
          subjectId: image.subject_id,
          fileName: image.file_name,
          filePath: image.file_path,
          uploadedAt: image.uploaded_at,
          pageLabel: image.page_label,
          url: `/uploads/${path.basename(image.file_path)}`,
        })),
        units: listAllUnits.all().filter((unit) => unit.subject_id === subject.id).map(unitRowToObject),
      }))

      const drafts = listAllUnits.all().filter((unit) => unit.status === 'draft').map(unitRowToObject)
      const projectSettings = getProjectSettings()
      const providerSettings = db.prepare('SELECT * FROM provider_settings ORDER BY provider ASC').all().map(normalizeProviderSetting)
      const usageLogs = db.prepare('SELECT * FROM usage_logs ORDER BY timestamp DESC LIMIT 200').all().map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        subjectId: row.subject_id,
        feature: row.feature,
        provider: row.provider,
        model: row.model,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
        estimatedCost: row.estimated_cost,
        currency: row.currency,
        status: row.status,
        jobId: row.job_id,
        details: parseJson(row.details_json, {}),
      }))

      return { subjects, drafts, projectSettings, providerSettings, usageLogs, users: this.listUsers() }
    },
    getProjectSettings,
    saveProjectSettings(input) {
      const next = normalizeProjectSettings({
        ...getProjectSettings(),
        ...input,
      })

      db.prepare(`
        UPDATE app_settings
        SET value_json = ?,
            updated_at = ?
        WHERE key = ?
      `).run(serializeJson(next), now(), 'project_settings')

      return getProjectSettings()
    },
    createSubject({ name, description, themeColor }) {
      const subject = {
        id: `subject-${randomUUID()}`,
        name,
        description,
        themeColor,
        status: 'active',
        createdAt: now(),
      }
      db.prepare(`
        INSERT INTO subjects (id, name, description, theme_color, status, created_at)
        VALUES (@id, @name, @description, @themeColor, @status, @createdAt)
      `).run(subject)
      return subject
    },
    addSubjectImage({ subjectId, fileName, filePath, pageLabel }) {
      const image = {
        id: `image-${randomUUID()}`,
        subjectId,
        fileName,
        filePath,
        pageLabel: pageLabel || '',
        uploadedAt: now(),
      }
      db.prepare(`
        INSERT INTO subject_images (id, subject_id, file_name, file_path, uploaded_at, page_label)
        VALUES (@id, @subjectId, @fileName, @filePath, @uploadedAt, @pageLabel)
      `).run(image)
      return image
    },
    getImagesByIds(subjectId, imageIds) {
      const placeholders = imageIds.map(() => '?').join(', ')
      return db
        .prepare(`SELECT * FROM subject_images WHERE subject_id = ? AND id IN (${placeholders})`)
        .all(subjectId, ...imageIds)
        .map((image) => ({
          id: image.id,
          subjectId: image.subject_id,
          fileName: image.file_name,
          filePath: image.file_path,
          uploadedAt: image.uploaded_at,
          pageLabel: image.page_label,
        }))
    },
    getSubject(subjectId) {
      const subject = findSubject.get(subjectId)
      if (!subject) {
        return null
      }

      return {
        id: subject.id,
        name: subject.name,
        description: subject.description,
        themeColor: subject.theme_color,
        status: subject.status,
        createdAt: subject.created_at,
      }
    },
    insertUnit(unit) {
      const payload = {
        id: unit.id,
        subjectId: unit.subjectId,
        title: unit.title,
        source: unit.source,
        stage: unit.stage,
        goal: unit.goal,
        difficulty: unit.difficulty,
        unlockOrder: unit.unlockOrder,
        coverEmoji: unit.coverEmoji,
        themeColor: unit.themeColor,
        status: unit.status,
        contentOrigin: unit.contentOrigin,
        sourceImageIds: serializeJson(unit.sourceImageIds),
        rewardRuleJson: serializeJson(unit.rewardRule),
        vocabularyJson: serializeJson(unit.vocabulary),
        patternsJson: serializeJson(unit.patterns),
        readingJson: serializeJson(unit.reading),
        activitiesJson: serializeJson(unit.activities),
        createdAt: now(),
        updatedAt: now(),
      }
      insertUnitStmt.run(payload)
      return unit
    },
    updateUnit(partial) {
      const existing = findUnit.get(partial.id)
      if (!existing) {
        return null
      }

      const current = unitRowToObject(existing)
      const next = {
        ...current,
        ...partial,
      }

      updateUnitStmt.run({
        id: next.id,
        title: next.title,
        source: next.source,
        stage: next.stage,
        goal: next.goal,
        difficulty: next.difficulty,
        unlockOrder: next.unlockOrder,
        coverEmoji: next.coverEmoji,
        themeColor: next.themeColor,
        status: next.status,
        contentOrigin: next.contentOrigin,
        sourceImageIds: serializeJson(next.sourceImageIds),
        rewardRuleJson: serializeJson(next.rewardRule),
        vocabularyJson: serializeJson(next.vocabulary),
        patternsJson: serializeJson(next.patterns),
        readingJson: serializeJson(next.reading),
        activitiesJson: serializeJson(next.activities),
        updatedAt: now(),
      })
      return next
    },
    findUnit(unitId) {
      const unit = findUnit.get(unitId)
      return unit ? unitRowToObject(unit) : null
    },
    publishUnit(unitId) {
      const existing = findUnit.get(unitId)
      if (!existing) {
        return null
      }

      db.prepare('UPDATE units SET status = ?, updated_at = ? WHERE id = ?').run('published', now(), unitId)
      return this.findUnit(unitId)
    },
    getProviderSettings() {
      return db.prepare('SELECT * FROM provider_settings ORDER BY provider ASC').all().map(normalizeProviderSetting)
    },
    getProviderSetting(provider) {
      const row = db.prepare('SELECT * FROM provider_settings WHERE provider = ?').get(provider)
      return row ? normalizeProviderSetting(row) : null
    },
    saveProviderSetting(provider, input) {
      const normalized = normalizeProviderInput(provider, input)
      db.prepare(`
        UPDATE provider_settings
        SET api_mode = @apiMode,
            model = @model,
            api_key = @apiKey,
            base_url = @baseUrl,
            endpoint = @endpoint,
            reasoning_effort = @reasoningEffort,
            temperature = @temperature,
            max_output_tokens = @maxOutputTokens,
            extra_json = @extraJson,
            pricing_json = @pricingJson,
            updated_at = @updatedAt
        WHERE provider = @provider
      `).run({
        provider,
        apiMode: normalized.apiMode,
        model: normalized.model,
        apiKey: normalized.apiKey,
        baseUrl: normalized.baseUrl,
        endpoint: normalized.endpoint,
        reasoningEffort: normalized.reasoningEffort,
        temperature: normalized.temperature,
        maxOutputTokens: normalized.maxOutputTokens,
        extraJson: serializeJson(normalized.extra),
        pricingJson: serializeJson(normalized.pricing),
        updatedAt: now(),
      })
      return this.getProviderSetting(provider)
    },
    createGenerationJob({ subjectId, imageIds, provider, model }) {
      const job = {
        id: `job-${randomUUID()}`,
        subjectId,
        imageIds,
        provider,
        model,
        status: 'running',
        createdAt: now(),
      }
      db.prepare(`
        INSERT INTO generation_jobs (id, subject_id, image_ids, provider, model, status, created_at)
        VALUES (@id, @subjectId, @imageIdsJson, @provider, @model, @status, @createdAt)
      `).run({
        ...job,
        imageIdsJson: serializeJson(imageIds),
      })
      return job
    },
    completeGenerationJob({ jobId, draftUnitId, ocrText }) {
      db.prepare(`
        UPDATE generation_jobs
        SET status = 'success',
            draft_unit_id = ?,
            ocr_text = ?
        WHERE id = ?
      `).run(draftUnitId, ocrText, jobId)
    },
    failGenerationJob({ jobId, errorMessage }) {
      db.prepare(`
        UPDATE generation_jobs
        SET status = 'failed',
            error_message = ?
        WHERE id = ?
      `).run(errorMessage, jobId)
    },
    insertUsageLog({
      timestamp,
      subjectId,
      feature,
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost,
      currency,
      status,
      jobId,
      details,
    }) {
      db.prepare(`
        INSERT INTO usage_logs
        (timestamp, subject_id, feature, provider, model, input_tokens, output_tokens, total_tokens, estimated_cost, currency, status, job_id, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        timestamp,
        subjectId || null,
        feature,
        provider,
        model,
        inputTokens || 0,
        outputTokens || 0,
        totalTokens || 0,
        estimatedCost ?? null,
        currency || 'USD',
        status,
        jobId || null,
        serializeJson(details || {}),
      )
    },
    listUsageLogs(filters = {}) {
      const clauses = []
      const values = []
      if (filters.subjectId) {
        clauses.push('subject_id = ?')
        values.push(filters.subjectId)
      }
      if (filters.provider) {
        clauses.push('provider = ?')
        values.push(filters.provider)
      }
      if (filters.feature) {
        clauses.push('feature = ?')
        values.push(filters.feature)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      return db
        .prepare(`SELECT * FROM usage_logs ${where} ORDER BY timestamp DESC LIMIT 200`)
        .all(...values)
        .map((row) => ({
          id: row.id,
          timestamp: row.timestamp,
          subjectId: row.subject_id,
          feature: row.feature,
          provider: row.provider,
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          totalTokens: row.total_tokens,
          estimatedCost: row.estimated_cost,
          currency: row.currency,
          status: row.status,
          jobId: row.job_id,
          details: parseJson(row.details_json, {}),
        }))
    },
    createSpeakingRecording({ userId, unitId, activityId, filePath, mimeType, durationSeconds }) {
      const recording = {
        id: `recording-${randomUUID()}`,
        userId,
        unitId,
        activityId,
        filePath,
        mimeType,
        durationSeconds,
        createdAt: now(),
      }
      db.prepare(`
        INSERT INTO speaking_recordings
        (id, user_id, unit_id, activity_id, file_path, mime_type, duration_seconds, created_at, mistakes_json)
        VALUES
        (@id, @userId, @unitId, @activityId, @filePath, @mimeType, @durationSeconds, @createdAt, '[]')
      `).run(recording)
      return speakingRecordingRowToObject(findSpeakingRecordingStmt.get(recording.id, userId))
    },
    listSpeakingRecordings(userId, unitId, activityId) {
      return listSpeakingRecordingsStmt.all(userId, unitId, activityId).map(speakingRecordingRowToObject)
    },
    getSpeakingRecording(userId, recordingId) {
      const row = findSpeakingRecordingStmt.get(recordingId, userId)
      return row ? speakingRecordingRowToObject(row) : null
    },
    getSpeakingRecordingFile(userId, recordingId) {
      const row = findSpeakingRecordingStmt.get(recordingId, userId)
      if (!row) {
        return null
      }

      return {
        filePath: row.file_path,
        mimeType: row.mime_type,
      }
    },
    updateSpeakingRecordingEvaluation(userId, recordingId, result) {
      db.prepare(`
        UPDATE speaking_recordings
        SET transcript = ?,
            normalized_transcript = ?,
            normalized_target = ?,
            score = ?,
            passed = ?,
            feedback = ?,
            mistakes_json = ?,
            submitted_at = ?,
            error_message = ''
        WHERE id = ? AND user_id = ?
      `).run(
        result.transcript || '',
        result.normalizedTranscript || '',
        result.normalizedTarget || '',
        result.score,
        result.passed ? 1 : 0,
        result.feedback || '',
        serializeJson(result.mistakes || []),
        now(),
        recordingId,
        userId,
      )
      return this.getSpeakingRecording(userId, recordingId)
    },
    setSpeakingRecordingError(userId, recordingId, message) {
      db.prepare('UPDATE speaking_recordings SET error_message = ? WHERE id = ? AND user_id = ?').run(message, recordingId, userId)
      return this.getSpeakingRecording(userId, recordingId)
    },
    deleteSpeakingRecording(userId, recordingId) {
      const row = findSpeakingRecordingStmt.get(recordingId, userId)
      if (!row) {
        return false
      }

      if (row.file_path && fs.existsSync(row.file_path)) {
        fs.rmSync(row.file_path, { force: true })
      }

      return deleteSpeakingRecordingStmt.run(recordingId, userId).changes > 0
    },
  }
}
