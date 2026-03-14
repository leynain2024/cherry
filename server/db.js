import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { resolveDataDir } from './data-dir.js'
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
  maxOutputTokens: 8192,
  speechModel: 'gpt-4o-mini-transcribe',
  ttsModel: 'gpt-4o-mini-tts',
  ttsVoice: 'alloy',
  ttsFormat: 'mp3',
  ttsInstructions: 'Read in a warm, patient classroom voice for primary-school English learners.',
  ocrModel: 'gpt-5.2',
  proxyUrl: '',
}

const openAiModelOptions = ['gpt-5.2', 'gpt-5.4']
const openAiReasoningOptions = ['none', 'low', 'medium', 'high', 'xhigh']
const openAiVerbosityOptions = ['low', 'medium', 'high']
const openAiSpeechModelOptions = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe']
const openAiTtsModelOptions = ['gpt-4o-mini-tts']
const openAiTtsVoiceOptions = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar']
const openAiTtsFormatOptions = ['mp3', 'wav']
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
  ttsModel: 'qwen3-tts-flash',
  ttsVoice: 'Cherry',
  ttsLanguageType: 'English',
  ttsFormat: 'wav',
  ttsInstructions: '',
}

const qwenApiModeOptions = ['native', 'compatible']
const qwenModelOptions = ['qwen-turbo', 'qwen-plus', 'qwen-max']
const qwenTemperatureOptions = [0, 0.2, 0.5, 0.8, 1]
const qwenMaxTokenOptions = [512, 1024, 2048, 4096]
const qwenSpeechModelOptions = ['qwen3-asr-flash', 'qwen-audio-turbo']
const qwenTtsModelOptions = ['qwen3-tts-flash']
const qwenTtsVoiceOptions = [
  'Cherry',
  'Serena',
  'Ethan',
  'Chelsie',
  'Momo',
  'Vivian',
  'Moon',
  'Maia',
  'Kai',
  'Nofish',
  'Bella',
  'Jennifer',
  'Ryan',
  'Katerina',
  'Aiden',
  'Eldric Sage',
  'Mia',
  'Mochi',
  'Bellona',
  'Vincent',
  'Bunny',
  'Neil',
  'Elias',
  'Arthur',
  'Nini',
  'Ebona',
  'Seren',
  'Pip',
  'Stella',
  'Bodega',
  'Sonrisa',
  'Alek',
  'Dolce',
  'Sohee',
  'Ono Anna',
  'Lenn',
  'Emilien',
  'Andre',
  'Radio Gol',
  'Jada',
  'Dylan',
  'Li',
  'Marcus',
  'Roy',
  'Peter',
  'Sunny',
  'Eric',
  'Rocky',
  'Kiki',
]
const qwenTtsFormatOptions = ['wav', 'mp3']

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
  dailyLessonMinMinutes: 15,
  dailyLessonMaxMinutes: 15,
}

const normalizeProjectSettings = (input = {}) => ({
  activeAiVendor: input.activeAiVendor === 'aliyun' ? 'aliyun' : 'openai',
  speakingPassScore: speakingPassScoreOptions.includes(Number(input.speakingPassScore)) ? Number(input.speakingPassScore) : 60,
  dailyLessonMinMinutes: Math.max(5, Number(input.dailyLessonMinMinutes) || projectSettingsDefaults.dailyLessonMinMinutes),
  dailyLessonMaxMinutes: Math.max(
    Math.max(5, Number(input.dailyLessonMinMinutes) || projectSettingsDefaults.dailyLessonMinMinutes),
    Number(input.dailyLessonMaxMinutes) || projectSettingsDefaults.dailyLessonMaxMinutes,
  ),
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
  const ttsModel = openAiTtsModelOptions.includes(extra.ttsModel) ? extra.ttsModel : openAiDefaults.ttsModel
  const ttsFormat = openAiTtsFormatOptions.includes(extra.ttsFormat) ? extra.ttsFormat : openAiDefaults.ttsFormat
  const ocrModel = openAiModelOptions.includes(extra.ocrModel) ? extra.ocrModel : openAiDefaults.ocrModel
  const proxyUrl = typeof extra.proxyUrl === 'string' ? extra.proxyUrl.trim() : openAiDefaults.proxyUrl
  const ttsVoice = openAiTtsVoiceOptions.includes(extra.ttsVoice) ? extra.ttsVoice : openAiDefaults.ttsVoice
  const ttsInstructions =
    typeof extra.ttsInstructions === 'string' && extra.ttsInstructions.trim()
      ? extra.ttsInstructions.trim()
      : openAiDefaults.ttsInstructions

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
      ttsModel,
      ttsVoice,
      ttsFormat,
      ttsInstructions,
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
      ttsModel: qwenTtsModelOptions.includes(extra.ttsModel) ? extra.ttsModel : qwenDefaults.ttsModel,
      ttsVoice: qwenTtsVoiceOptions.includes(extra.ttsVoice) ? extra.ttsVoice : qwenDefaults.ttsVoice,
      ttsLanguageType:
        typeof extra.ttsLanguageType === 'string' && extra.ttsLanguageType.trim()
          ? extra.ttsLanguageType.trim()
          : qwenDefaults.ttsLanguageType,
      ttsFormat: qwenTtsFormatOptions.includes(extra.ttsFormat) ? extra.ttsFormat : qwenDefaults.ttsFormat,
      ttsInstructions:
        typeof extra.ttsInstructions === 'string' && extra.ttsInstructions.trim() ? extra.ttsInstructions.trim() : qwenDefaults.ttsInstructions,
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

const flattenLessonActivities = (lessons = []) =>
  lessons.flatMap((lesson) =>
    (lesson.activities || []).map((activity) => ({
      ...activity,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
    })),
  )

const buildLessonSections = (lessonId, activities = []) =>
  ['listen', 'speak', 'read', 'write'].map((skill) => {
    const skillActivities = activities.filter((activity) => activity.skill === skill)
    return {
      id: `${lessonId}-${skill}`,
      skill,
      title: skill.toUpperCase(),
      activityIds: skillActivities.map((activity) => activity.id),
      estimatedMinutes: skillActivities.reduce((total, activity) => total + (activity.durationMinutes || 0), 0),
    }
  })

const buildLegacyActivities = (unit, vocabularyBank) => {
  const activities = Array.isArray(unit.activities) ? [...unit.activities] : []
  const reading = unit.reading || null
  const hasReadChoice = activities.some((activity) => activity.kind === 'read-choice')

  if (!hasReadChoice && reading && (reading.content || reading.question)) {
    activities.unshift({
      id: reading.id || `${unit.id}-reading`,
      title: reading.title || '阅读理解',
      prompt: '读一读，再回答问题。',
      skill: 'read',
      kind: 'read-choice',
      durationMinutes: 3,
      passage: reading.content || '',
      audioText: reading.audioText || '',
      question: reading.question || '根据内容选择正确答案。',
      options: [
        {
          id: 'a',
          label: vocabularyBank[0]?.meaning || '继续学习',
        },
      ],
      correctOptionId: 'a',
    })
  }

  return activities
}

const normalizeUnitShape = (unit) => {
  const vocabularyBank =
    (Array.isArray(unit?.vocabularyBank) && unit.vocabularyBank.length ? unit.vocabularyBank : null) ||
    (Array.isArray(unit?.vocabulary) ? unit.vocabulary : [])
  const contentInventory = Array.isArray(unit?.contentInventory) ? unit.contentInventory : []
  const lessonSeed =
    Array.isArray(unit?.lessons) && unit.lessons.length
      ? unit.lessons
      : [
          {
            id: `${unit.id}-lesson-1`,
            title: `${unit.title} Lesson 1`,
            order: 1,
            estimatedMinutes: 0,
            sourcePageIds: Array.isArray(unit?.sourceImageIds) ? unit.sourceImageIds : [],
            sourceLessonLabel: 'LESSON 1',
            vocabularyRefs: vocabularyBank.map((item) => item.id),
            sections: [],
            activities: buildLegacyActivities(unit, vocabularyBank),
            lessonQuiz: null,
          },
        ]

  const lessons = lessonSeed
    .map((lesson, index) => {
      const lessonId = lesson.id || `${unit.id}-lesson-${index + 1}`
      const lessonTitle = lesson.title || `${unit.title} Lesson ${index + 1}`
      const activities = (lesson.activities || []).map((activity) => ({
        ...activity,
        lessonId: activity.lessonId || lessonId,
        lessonTitle: activity.lessonTitle || lessonTitle,
      }))
      return {
        id: lessonId,
        title: lessonTitle,
        order: lesson.order || index + 1,
        estimatedMinutes:
          lesson.estimatedMinutes || activities.reduce((total, activity) => total + (activity.durationMinutes || 0), 0),
        sourcePageIds:
          Array.isArray(lesson.sourcePageIds) && lesson.sourcePageIds.length
            ? lesson.sourcePageIds
            : Array.isArray(unit?.sourceImageIds)
              ? unit.sourceImageIds
              : [],
        sourceLessonLabel: lesson.sourceLessonLabel || `LESSON ${index + 1}`,
        vocabularyRefs:
          Array.isArray(lesson.vocabularyRefs) && lesson.vocabularyRefs.length
            ? lesson.vocabularyRefs
            : vocabularyBank.map((item) => item.id),
        sections:
          Array.isArray(lesson.sections) && lesson.sections.length ? lesson.sections : buildLessonSections(lessonId, activities),
        activities,
        lessonQuiz: lesson.lessonQuiz || activities.find((activity) => activity.kind === 'challenge') || null,
      }
    })
    .filter(Boolean)

  const activities = flattenLessonActivities(lessons)

  return {
    ...unit,
    vocabularyBank,
    contentInventory,
    lessons,
    unitReview: unit?.unitReview ?? null,
    unitTest: unit?.unitTest ?? null,
    vocabulary: vocabularyBank,
    reading: deriveReadingSummary(lessons),
    activities,
  }
}

const deriveReadingSummary = (lessons = []) => {
  const readActivity = flattenLessonActivities(lessons).find((activity) => activity.kind === 'read-choice')
  if (!readActivity) {
    return {
      id: randomUUID(),
      title: '阅读内容',
      content: '',
      audioText: '',
      question: '',
    }
  }

  return {
    id: `reading-${readActivity.id}`,
    title: readActivity.title,
    content: readActivity.passage || '',
    audioText: readActivity.audioText || '',
    question: readActivity.question || '',
  }
}

const unitRowToObject = (row) => {
  return normalizeUnitShape({
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
    vocabularyBank: parseJson(row.vocabulary_bank_json, parseJson(row.vocabulary_json, [])),
    patterns: parseJson(row.patterns_json, []),
    contentInventory: parseJson(row.content_inventory_json, []),
    lessons: parseJson(row.lessons_json, []),
    reading: parseJson(row.reading_json, {}),
    activities: parseJson(row.activities_json, []),
    unitReview: parseJson(row.unit_review_json, null),
    unitTest: parseJson(row.unit_test_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

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
  lessonId: row.lesson_id || '',
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

const generationJobRowToObject = (row) => ({
  id: row.id,
  subjectId: row.subject_id,
  imageIds: parseJson(row.image_ids, []),
  provider: row.provider,
  model: row.model,
  status: row.status,
  stage: row.stage || 'queued',
  processedImages: row.processed_images || 0,
  totalImages: row.total_images || 0,
  message: row.message || '',
  hasOcrText: Boolean(row.ocr_text),
  hasDraftResponse: Boolean(row.draft_response_text),
  hasParsedPayload: Boolean(row.parsed_payload_json),
  draftUnitId: row.draft_unit_id || '',
  errorMessage: row.error_message || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at || row.created_at,
})

const isStructuredUnit = (unit) => Array.isArray(unit?.lessons) && unit.lessons.length > 0

export const createDataStore = ({ rootDir = process.cwd() } = {}) => {
  const dataDir = resolveDataDir({ rootDir })
  const uploadsDir = path.join(dataDir, 'uploads')
  const recordingsDir = path.join(dataDir, 'recordings')
  const audioAssetsDir = path.join(dataDir, 'audio-assets')
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.mkdirSync(recordingsDir, { recursive: true })
  fs.mkdirSync(audioAssetsDir, { recursive: true })

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
      lesson_id TEXT,
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
      vocabulary_bank_json TEXT NOT NULL DEFAULT '[]',
      content_inventory_json TEXT NOT NULL DEFAULT '[]',
      lessons_json TEXT NOT NULL DEFAULT '[]',
      unit_review_json TEXT NOT NULL DEFAULT 'null',
      unit_test_json TEXT NOT NULL DEFAULT 'null',
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
      stage TEXT NOT NULL DEFAULT 'queued',
      processed_images INTEGER NOT NULL DEFAULT 0,
      total_images INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      draft_unit_id TEXT,
      ocr_text TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

  const generationJobColumns = db.prepare('PRAGMA table_info(generation_jobs)').all()
  if (!generationJobColumns.some((column) => column.name === 'stage')) {
    db.exec(`ALTER TABLE generation_jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued'`)
  }
  if (!generationJobColumns.some((column) => column.name === 'processed_images')) {
    db.exec('ALTER TABLE generation_jobs ADD COLUMN processed_images INTEGER NOT NULL DEFAULT 0')
  }
  if (!generationJobColumns.some((column) => column.name === 'total_images')) {
    db.exec('ALTER TABLE generation_jobs ADD COLUMN total_images INTEGER NOT NULL DEFAULT 0')
  }
  if (!generationJobColumns.some((column) => column.name === 'message')) {
    db.exec('ALTER TABLE generation_jobs ADD COLUMN message TEXT')
  }
  if (!generationJobColumns.some((column) => column.name === 'updated_at')) {
    db.exec('ALTER TABLE generation_jobs ADD COLUMN updated_at TEXT')
    db.prepare('UPDATE generation_jobs SET updated_at = created_at WHERE updated_at IS NULL').run()
  }
  if (!generationJobColumns.some((column) => column.name === 'draft_response_text')) {
    db.exec('ALTER TABLE generation_jobs ADD COLUMN draft_response_text TEXT')
  }
  if (!generationJobColumns.some((column) => column.name === 'parsed_payload_json')) {
    db.exec('ALTER TABLE generation_jobs ADD COLUMN parsed_payload_json TEXT')
  }

  const unitColumns = db.prepare('PRAGMA table_info(units)').all()
  if (!unitColumns.some((column) => column.name === 'vocabulary_bank_json')) {
    db.exec(`ALTER TABLE units ADD COLUMN vocabulary_bank_json TEXT NOT NULL DEFAULT '[]'`)
  }
  if (!unitColumns.some((column) => column.name === 'content_inventory_json')) {
    db.exec(`ALTER TABLE units ADD COLUMN content_inventory_json TEXT NOT NULL DEFAULT '[]'`)
  }
  if (!unitColumns.some((column) => column.name === 'lessons_json')) {
    db.exec(`ALTER TABLE units ADD COLUMN lessons_json TEXT NOT NULL DEFAULT '[]'`)
  }
  if (!unitColumns.some((column) => column.name === 'unit_review_json')) {
    db.exec(`ALTER TABLE units ADD COLUMN unit_review_json TEXT NOT NULL DEFAULT 'null'`)
  }
  if (!unitColumns.some((column) => column.name === 'unit_test_json')) {
    db.exec(`ALTER TABLE units ADD COLUMN unit_test_json TEXT NOT NULL DEFAULT 'null'`)
  }

  const userActivityColumns = db.prepare('PRAGMA table_info(user_activity_progress)').all()
  if (!userActivityColumns.some((column) => column.name === 'lesson_id')) {
    db.exec('ALTER TABLE user_activity_progress ADD COLUMN lesson_id TEXT')
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
        ttsModel: openAiDefaults.ttsModel,
        ttsVoice: openAiDefaults.ttsVoice,
        ttsFormat: openAiDefaults.ttsFormat,
        ttsInstructions: openAiDefaults.ttsInstructions,
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
        ttsModel: qwenDefaults.ttsModel,
        ttsVoice: qwenDefaults.ttsVoice,
        ttsLanguageType: qwenDefaults.ttsLanguageType,
        ttsFormat: qwenDefaults.ttsFormat,
        ttsInstructions: qwenDefaults.ttsInstructions,
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

  db.prepare(
    `
      UPDATE provider_settings
      SET max_output_tokens = ?, updated_at = ?
      WHERE provider = 'openai' AND max_output_tokens = 2048
    `,
  ).run(openAiDefaults.maxOutputTokens, now())

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

  }

  const unitCount = db.prepare('SELECT COUNT(*) AS count FROM units').get().count
  if (!unitCount) {
    const seedInsertUnit = db.prepare(`
      INSERT INTO units
      (id, subject_id, title, source, stage, goal, difficulty, unlock_order, cover_emoji, theme_color, status, content_origin, source_image_ids, reward_rule_json, vocabulary_json, patterns_json, reading_json, activities_json, vocabulary_bank_json, content_inventory_json, lessons_json, unit_review_json, unit_test_json, created_at, updated_at)
      VALUES
      (@id, @subjectId, @title, @source, @stage, @goal, @difficulty, @unlockOrder, @coverEmoji, @themeColor, @status, @contentOrigin, @sourceImageIds, @rewardRuleJson, @vocabularyJson, @patternsJson, @readingJson, @activitiesJson, @vocabularyBankJson, @contentInventoryJson, @lessonsJson, @unitReviewJson, @unitTestJson, @createdAt, @updatedAt)
    `)

    buildFrameworkUnits(defaultSubject.id).forEach((unit) => {
      const normalizedUnit = normalizeUnitShape(unit)
      seedInsertUnit.run({
        id: normalizedUnit.id,
        subjectId: normalizedUnit.subjectId,
        title: normalizedUnit.title,
        source: normalizedUnit.source,
        stage: normalizedUnit.stage,
        goal: normalizedUnit.goal,
        difficulty: normalizedUnit.difficulty,
        unlockOrder: normalizedUnit.unlockOrder,
        coverEmoji: normalizedUnit.coverEmoji,
        themeColor: normalizedUnit.themeColor,
        status: normalizedUnit.status,
        contentOrigin: normalizedUnit.contentOrigin,
        sourceImageIds: serializeJson(normalizedUnit.sourceImageIds),
        rewardRuleJson: serializeJson(normalizedUnit.rewardRule),
        vocabularyJson: serializeJson(normalizedUnit.vocabulary),
        patternsJson: serializeJson(normalizedUnit.patterns),
        readingJson: serializeJson(normalizedUnit.reading),
        activitiesJson: serializeJson(normalizedUnit.activities),
        vocabularyBankJson: serializeJson(normalizedUnit.vocabularyBank || []),
        contentInventoryJson: serializeJson(normalizedUnit.contentInventory || []),
        lessonsJson: serializeJson(normalizedUnit.lessons || []),
        unitReviewJson: serializeJson(normalizedUnit.unitReview ?? null),
        unitTestJson: serializeJson(normalizedUnit.unitTest ?? null),
        createdAt: unit.createdAt || now(),
        updatedAt: unit.updatedAt || now(),
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
    (user_id, unit_id, lesson_id, activity_id, completed, score, duration_seconds, mistakes_json, completed_at)
    VALUES
    (@userId, @unitId, @lessonId, @activityId, @completed, @score, @durationSeconds, @mistakesJson, @completedAt)
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
        vocabulary_bank_json = @vocabularyBankJson,
        content_inventory_json = @contentInventoryJson,
        lessons_json = @lessonsJson,
        unit_review_json = @unitReviewJson,
        unit_test_json = @unitTestJson,
        updated_at = @updatedAt
    WHERE id = @id
  `)
  const insertUnitStmt = db.prepare(`
    INSERT INTO units
    (id, subject_id, title, source, stage, goal, difficulty, unlock_order, cover_emoji, theme_color, status, content_origin, source_image_ids, reward_rule_json, vocabulary_json, patterns_json, reading_json, activities_json, vocabulary_bank_json, content_inventory_json, lessons_json, unit_review_json, unit_test_json, created_at, updated_at)
    VALUES
    (@id, @subjectId, @title, @source, @stage, @goal, @difficulty, @unlockOrder, @coverEmoji, @themeColor, @status, @contentOrigin, @sourceImageIds, @rewardRuleJson, @vocabularyJson, @patternsJson, @readingJson, @activitiesJson, @vocabularyBankJson, @contentInventoryJson, @lessonsJson, @unitReviewJson, @unitTestJson, @createdAt, @updatedAt)
  `)

  const normalizeProviderSetting = (row) => {
    const normalized = normalizeProviderInput(row.provider, {
      apiMode: row.api_mode,
      model: row.model,
      apiKey: row.api_key,
      baseUrl: row.base_url,
      endpoint: row.endpoint,
      reasoningEffort: row.reasoning_effort,
      temperature: row.temperature,
      maxOutputTokens: row.max_output_tokens,
      extra: parseJson(row.extra_json, {}),
      pricing: normalizePricing(parseJson(row.pricing_json, {})),
    })

    return {
      provider: row.provider,
      apiMode: normalized.apiMode,
      model: normalized.model,
      apiKey: normalized.apiKey,
      baseUrl: normalized.baseUrl,
      endpoint: normalized.endpoint,
      reasoningEffort: normalized.reasoningEffort,
      temperature: normalized.temperature,
      maxOutputTokens: normalized.maxOutputTokens,
      ...normalized.extra,
      pricing: normalized.pricing,
      updatedAt: row.updated_at,
    }
  }

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
      .filter(isStructuredUnit)
      .filter((unit) => !subjectId || unit.subjectId === subjectId)
    const publishedUnitIds = new Set(publishedUnits.map((unit) => unit.id))
    const profile = findUserProfile.get(userId)
    const activityRows = listUserActivityProgress
      .all(userId)
      .filter((row) => !subjectId || publishedUnitIds.has(row.unit_id))
    const activityResults = activityRows.reduce((acc, row) => {
      const unit = publishedUnits.find((item) => item.id === row.unit_id)
      const inferredLessonId =
        row.lesson_id ||
        flattenLessonActivities(unit?.lessons || []).find((activity) => activity.id === row.activity_id)?.lessonId ||
        ''
      const result = {
        ...progressRowToActivityResult(row),
        lessonId: inferredLessonId,
      }
      const key = `${row.unit_id}:${inferredLessonId}:${row.activity_id}`
      acc[key] = result
      const legacyKey = `${row.unit_id}:${row.activity_id}`
      if (!acc[legacyKey]) {
        acc[legacyKey] = result
      }
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
        lessonId: result.lessonId || '',
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
    audioAssetsDir,
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
        .filter(isStructuredUnit)
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
      const publishedUnits = listUnitsByStatus.all('published').map(unitRowToObject).filter(isStructuredUnit)
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
        units: listAllUnits.all().filter((unit) => unit.subject_id === subject.id).map(unitRowToObject).filter(isStructuredUnit),
      }))

      const drafts = listAllUnits.all().filter((unit) => unit.status === 'draft').map(unitRowToObject).filter(isStructuredUnit)
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

      return {
        subjects,
        drafts,
        generationJobs: this.listGenerationJobs({ limit: 50 }),
        projectSettings,
        providerSettings,
        usageLogs,
        users: this.listUsers(),
      }
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
      const rows = db
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
      const orderMap = new Map(imageIds.map((id, index) => [id, index]))
      return rows.sort((left, right) => (orderMap.get(left.id) ?? 0) - (orderMap.get(right.id) ?? 0))
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
      const normalizedUnit = normalizeUnitShape(unit)
      const payload = {
        id: normalizedUnit.id,
        subjectId: normalizedUnit.subjectId,
        title: normalizedUnit.title,
        source: normalizedUnit.source,
        stage: normalizedUnit.stage,
        goal: normalizedUnit.goal,
        difficulty: normalizedUnit.difficulty,
        unlockOrder: normalizedUnit.unlockOrder,
        coverEmoji: normalizedUnit.coverEmoji,
        themeColor: normalizedUnit.themeColor,
        status: normalizedUnit.status,
        contentOrigin: normalizedUnit.contentOrigin,
        sourceImageIds: serializeJson(normalizedUnit.sourceImageIds),
        rewardRuleJson: serializeJson(normalizedUnit.rewardRule),
        vocabularyJson: serializeJson(normalizedUnit.vocabulary || []),
        patternsJson: serializeJson(normalizedUnit.patterns),
        readingJson: serializeJson(normalizedUnit.reading || {}),
        activitiesJson: serializeJson(normalizedUnit.activities || []),
        vocabularyBankJson: serializeJson(normalizedUnit.vocabularyBank || []),
        contentInventoryJson: serializeJson(normalizedUnit.contentInventory || []),
        lessonsJson: serializeJson(normalizedUnit.lessons || []),
        unitReviewJson: serializeJson(normalizedUnit.unitReview ?? null),
        unitTestJson: serializeJson(normalizedUnit.unitTest ?? null),
        createdAt: now(),
        updatedAt: now(),
      }
      insertUnitStmt.run(payload)
      return normalizedUnit
    },
    updateUnit(partial) {
      const existing = findUnit.get(partial.id)
      if (!existing) {
        return null
      }

      const current = unitRowToObject(existing)
      const baseLessons =
        Array.isArray(partial.lessons) && partial.lessons.length ? partial.lessons : current.lessons
      const merged =
        Array.isArray(partial.activities)
          ? {
              ...current,
              ...partial,
              lessons: baseLessons.map((lesson) => ({
                ...lesson,
                activities: lesson.activities.map((activity) => {
                  const nextActivity = partial.activities.find((item) => item.id === activity.id)
                  return nextActivity
                    ? {
                        ...activity,
                        ...nextActivity,
                        lessonId: nextActivity.lessonId || activity.lessonId || lesson.id,
                        lessonTitle: nextActivity.lessonTitle || activity.lessonTitle || lesson.title,
                      }
                    : activity
                }),
              })),
            }
          : {
              ...current,
              ...partial,
            }
      const next = normalizeUnitShape(merged)

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
        vocabularyJson: serializeJson(next.vocabulary || []),
        patternsJson: serializeJson(next.patterns),
        readingJson: serializeJson(next.reading || {}),
        activitiesJson: serializeJson(next.activities || []),
        vocabularyBankJson: serializeJson(next.vocabularyBank || []),
        contentInventoryJson: serializeJson(next.contentInventory || []),
        lessonsJson: serializeJson(next.lessons || []),
        unitReviewJson: serializeJson(next.unitReview ?? null),
        unitTestJson: serializeJson(next.unitTest ?? null),
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
      const createdAt = now()
      const job = {
        id: `job-${randomUUID()}`,
        subjectId,
        imageIds,
        provider,
        model,
        status: 'running',
        stage: 'queued',
        processedImages: 0,
        totalImages: imageIds.length,
        message: '已加入生成队列，等待开始。',
        createdAt,
        updatedAt: createdAt,
      }
      db.prepare(`
        INSERT INTO generation_jobs
        (id, subject_id, image_ids, provider, model, status, stage, processed_images, total_images, message, created_at, updated_at)
        VALUES
        (@id, @subjectId, @imageIdsJson, @provider, @model, @status, @stage, @processedImages, @totalImages, @message, @createdAt, @updatedAt)
      `).run({
        ...job,
        imageIdsJson: serializeJson(imageIds),
      })
      return job
    },
    getGenerationJob(jobId) {
      const row = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId)
      return row ? generationJobRowToObject(row) : null
    },
    listGenerationJobs({ subjectId = '', limit = 30 } = {}) {
      const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30))
      const query = subjectId
        ? db.prepare(`
            SELECT *
            FROM generation_jobs
            WHERE subject_id = ?
            ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
            LIMIT ?
          `)
        : db.prepare(`
            SELECT *
            FROM generation_jobs
            ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
            LIMIT ?
          `)
      const rows = subjectId ? query.all(subjectId, safeLimit) : query.all(safeLimit)
      return rows.map(generationJobRowToObject)
    },
    getGenerationJobOcrText(jobId) {
      const row = db.prepare('SELECT ocr_text FROM generation_jobs WHERE id = ?').get(jobId)
      return row?.ocr_text || ''
    },
    getGenerationJobDraftResponse(jobId) {
      const row = db.prepare('SELECT draft_response_text FROM generation_jobs WHERE id = ?').get(jobId)
      return row?.draft_response_text || ''
    },
    getGenerationJobParsedPayload(jobId) {
      const row = db.prepare('SELECT parsed_payload_json FROM generation_jobs WHERE id = ?').get(jobId)
      return parseJson(row?.parsed_payload_json, null)
    },
    updateGenerationJobProgress({ jobId, stage, processedImages, totalImages, message }) {
      const existing = this.getGenerationJob(jobId)
      if (!existing) {
        return null
      }

      db.prepare(`
        UPDATE generation_jobs
        SET stage = ?,
            processed_images = ?,
            total_images = ?,
            message = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        stage || existing.stage,
        processedImages ?? existing.processedImages,
        totalImages ?? existing.totalImages,
        message ?? existing.message,
        now(),
        jobId,
      )

      return this.getGenerationJob(jobId)
    },
    saveGenerationJobOcrText({ jobId, ocrText }) {
      db.prepare(`
        UPDATE generation_jobs
        SET ocr_text = ?,
            updated_at = ?
        WHERE id = ?
      `).run(ocrText, now(), jobId)

      return this.getGenerationJob(jobId)
    },
    saveGenerationJobDraftResponse({ jobId, responseText }) {
      db.prepare(`
        UPDATE generation_jobs
        SET draft_response_text = ?,
            updated_at = ?
        WHERE id = ?
      `).run(responseText, now(), jobId)

      return this.getGenerationJob(jobId)
    },
    saveGenerationJobParsedPayload({ jobId, parsedPayload }) {
      db.prepare(`
        UPDATE generation_jobs
        SET parsed_payload_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(serializeJson(parsedPayload), now(), jobId)

      return this.getGenerationJob(jobId)
    },
    completeGenerationJob({ jobId, draftUnitId, ocrText }) {
      db.prepare(`
        UPDATE generation_jobs
        SET status = 'success',
            stage = 'completed',
            processed_images = total_images,
            message = '单元草稿已生成完成。',
            draft_unit_id = ?,
            ocr_text = ?,
            updated_at = ?
        WHERE id = ?
      `).run(draftUnitId, ocrText, now(), jobId)
    },
    createDraftRetryJob({ sourceJobId, provider, model, message }) {
      const sourceJob = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(sourceJobId)
      if (!sourceJob) {
        return null
      }

      const createdAt = now()
      const retryJob = {
        id: `job-${randomUUID()}`,
        subjectId: sourceJob.subject_id,
        imageIds: parseJson(sourceJob.image_ids, []),
        provider,
        model,
        status: 'running',
        stage: 'draft',
        processedImages: Number(sourceJob.total_images || 0),
        totalImages: Number(sourceJob.total_images || 0),
        message: message || '正在基于已完成的 OCR 结果重试草稿整理。',
        ocrText: sourceJob.ocr_text || '',
        createdAt,
        updatedAt: createdAt,
      }

      db.prepare(`
        INSERT INTO generation_jobs
        (id, subject_id, image_ids, provider, model, status, stage, processed_images, total_images, message, ocr_text, created_at, updated_at)
        VALUES
        (@id, @subjectId, @imageIdsJson, @provider, @model, @status, @stage, @processedImages, @totalImages, @message, @ocrText, @createdAt, @updatedAt)
      `).run({
        ...retryJob,
        imageIdsJson: serializeJson(retryJob.imageIds),
      })

      return this.getGenerationJob(retryJob.id)
    },
    failGenerationJob({ jobId, errorMessage }) {
      db.prepare(`
        UPDATE generation_jobs
        SET status = 'failed',
            stage = 'failed',
            message = ?,
            error_message = ?,
            updated_at = ?
        WHERE id = ?
      `).run(errorMessage, errorMessage, now(), jobId)
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
        durationSeconds: row.duration_seconds || 0,
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
