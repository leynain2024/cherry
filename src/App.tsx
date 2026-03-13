import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  ApiError,
  assignUserSubject,
  bootstrapAdmin,
  changeAdminPassword,
  createSubject,
  createUser,
  deleteSpeakingRecording,
  deleteUser,
  evaluateSpeaking,
  getGenerationJob,
  getSpeakingRecordings,
  generateUnitDraft,
  getAdminSession,
  getAdminState,
  getPublicAppData,
  getUserSession,
  loginAdmin,
  loginUser,
  logoutAdmin,
  logoutUser,
  publishDraft as publishDraftApi,
  resetUserPassword,
  retryGenerationDraft,
  saveUserProgress,
  saveProjectSettings,
  saveProviderSetting,
  updateDraft as updateDraftApi,
  uploadSpeakingRecording,
  uploadSubjectImages,
} from './api'
import {
  completeActivity,
  createDefaultProgress,
  getActivityStars,
  getScoreStars,
  getRecommendation,
  getTodayStudySummary,
  getPerfectUnitIds,
  getUnitStarCount,
  getUnitProgressPercent,
  summarizeWeakPoints,
  syncProgressDerivedState,
} from './learning-progress'
import type {
  Activity,
  AiVendor,
  AdminSession,
  AdminState,
  AppData,
  ChallengeActivity,
  ChoiceOption,
  GenerationJob,
  ProjectSettings,
  ProviderId,
  ProviderPricing,
  ProviderSetting,
  SpeakingRecording,
  SpeakingPassScore,
  StudentProgress,
  Subject,
  SubjectImage,
  Unit,
  User,
  UserSubjectAssignmentResult,
  UserSession,
} from './types'

type ViewName = 'login' | 'home' | 'learn' | 'report' | 'admin'
type AdminTab = 'subjects' | 'users' | 'images' | 'drafts' | 'settings' | 'security' | 'logs'

type SubmissionState =
  | { status: 'idle' }
  | { status: 'done'; score: number; stars: number; title: string; mistakes: string[]; completed: boolean }

type SecretFieldId = 'openai-api-key' | 'qwen-api-key' | 'aliyun-access-key-id' | 'aliyun-access-key-secret'
type QueueDropPosition = 'before' | 'after'

declare global {
  interface Window {
    render_game_to_text?: () => string
    advanceTime?: (ms: number) => Promise<void>
  }
}

const skillLabels = {
  listen: '听',
  speak: '说',
  read: '读',
  write: '写',
} as const

const vocabularyEmojiPairs = [
  { keyword: '挥手', emoji: '👋' },
  { keyword: '名字', emoji: '🏷️' },
  { keyword: '男孩', emoji: '👦' },
  { keyword: '女孩', emoji: '👧' },
  { keyword: '妈妈', emoji: '👩' },
  { keyword: '爸爸', emoji: '👨' },
  { keyword: '姐姐', emoji: '👧' },
  { keyword: '妹妹', emoji: '👧' },
  { keyword: '家庭', emoji: '🏠' },
  { keyword: '合照', emoji: '👨‍👩‍👧‍👦' },
  { keyword: '书包', emoji: '🎒' },
  { keyword: '课本', emoji: '📘' },
  { keyword: '书', emoji: '📕' },
  { keyword: '钢笔', emoji: '🖊️' },
  { keyword: '桌子', emoji: '🪑' },
  { keyword: '课桌', emoji: '🪑' },
  { keyword: '气球', emoji: '🎈' },
  { keyword: '太阳', emoji: '🌞' },
  { keyword: '树叶', emoji: '🍃' },
  { keyword: '玩具', emoji: '🧸' },
  { keyword: '小鸭', emoji: '🦆' },
  { keyword: '坐着', emoji: '🪑' },
  { keyword: '站着', emoji: '🧍' },
  { keyword: '打开', emoji: '📖' },
  { keyword: '合上', emoji: '📚' },
]

const escapeSvgText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const getVocabularyEmoji = (label: string, word: string, meaning: string) => {
  const source = `${label} ${word} ${meaning}`
  return vocabularyEmojiPairs.find((item) => source.includes(item.keyword))?.emoji || '✨'
}

const buildVocabularyIllustration = ({
  imageLabel,
  word,
  meaning,
}: {
  imageLabel: string
  word: string
  meaning: string
}) => {
  const emoji = getVocabularyEmoji(imageLabel, word, meaning)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420" role="img" aria-label="${escapeSvgText(
      imageLabel,
    )}">
      <defs>
        <linearGradient id="cardBg" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="#fdfefe" />
          <stop offset="100%" stop-color="#e5f4ff" />
        </linearGradient>
      </defs>
      <rect width="640" height="420" rx="40" fill="url(#cardBg)" />
      <circle cx="118" cy="108" r="72" fill="#d6eeff" />
      <circle cx="532" cy="82" r="42" fill="#edf7ff" />
      <circle cx="566" cy="332" r="52" fill="#dff1ff" />
      <text x="118" y="132" text-anchor="middle" font-size="80">${emoji}</text>
      <text x="64" y="230" font-size="42" font-family="Verdana, sans-serif" font-weight="700" fill="#173a5f">${escapeSvgText(
        word,
      )}</text>
      <text x="64" y="284" font-size="28" font-family="Verdana, sans-serif" fill="#4f7198">${escapeSvgText(
        meaning,
      )}</text>
      <text x="64" y="338" font-size="30" font-family="Verdana, sans-serif" fill="#2d74c9">${escapeSvgText(
        imageLabel,
      )}</text>
    </svg>
  `

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

const openAiModelOptions = [
  { value: 'gpt-5.2', label: 'gpt-5.2', note: '当前项目默认模型，适合稳定生成单元草稿。' },
  { value: 'gpt-5.4', label: 'gpt-5.4', note: '更强的推理与指令遵循，但成本更高。' },
] as const

const openAiReasoningOptions = [
  { value: 'none', label: 'none', note: '不启用推理，速度最快。' },
  { value: 'low', label: 'low', note: '轻度推理，适合简单整理。' },
  { value: 'medium', label: 'medium', note: '平衡质量与速度。' },
  { value: 'high', label: 'high', note: '更稳妥，适合教材整理。' },
  { value: 'xhigh', label: 'xhigh', note: '更深入推理，耗时与成本更高。' },
] as const

const openAiVerbosityOptions = [
  { value: 'low', label: 'low', note: '更简短。' },
  { value: 'medium', label: 'medium', note: '长度适中。' },
  { value: 'high', label: 'high', note: '更详细。' },
] as const

const openAiSpeechModelOptions = [
  { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe', note: '成本更低，适合日常口语跟读转写。' },
  { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', note: '转写能力更强，但成本更高。' },
] as const

const openAiTtsModelOptions = [
  { value: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', note: '适合预生成标准教学播报音频。' },
] as const

const openAiTtsVoiceOptions = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
].map((value) => ({
  value,
  label: value,
}))

const openAiTtsFormatOptions = [
  { value: 'mp3', label: 'mp3', note: '文件更小，适合网页播放。' },
  { value: 'wav', label: 'wav', note: '音质更高，但文件更大。' },
] as const

const openAiMaxOutputTokenOptions = [512, 1024, 2048, 4096, 8192, 16384] as const

const qwenApiModeOptions = [
  { value: 'native', label: 'native', note: '阿里原生接口，文本生成默认推荐。' },
  { value: 'compatible', label: 'compatible', note: 'OpenAI 兼容模式，便于接入兼容 SDK。' },
] as const

const qwenModelOptions = [
  { value: 'qwen-turbo', label: 'qwen-turbo', note: '速度更快。' },
  { value: 'qwen-plus', label: 'qwen-plus', note: '当前默认，质量与成本更平衡。' },
  { value: 'qwen-max', label: 'qwen-max', note: '能力更强，成本更高。' },
] as const

const qwenTemperatureOptions = [
  { value: 0, label: '0.0', note: '最稳定，适合结构化输出。' },
  { value: 0.2, label: '0.2', note: '当前默认，稳定中带一点灵活。' },
  { value: 0.5, label: '0.5', note: '更活跃。' },
  { value: 0.8, label: '0.8', note: '更发散。' },
  { value: 1, label: '1.0', note: '随机性最高。' },
] as const

const qwenMaxTokenOptions = [512, 1024, 2048, 4096] as const

const qwenSpeechModelOptions = [
  { value: 'qwen3-asr-flash', label: 'qwen3-asr-flash', note: '适合语音转写场景。' },
  { value: 'qwen-audio-turbo', label: 'qwen-audio-turbo', note: '支持更丰富音频理解。' },
] as const

const qwenTtsModelOptions = [
  { value: 'qwen3-tts-flash', label: 'qwen3-tts-flash', note: '适合预生成英语句子播报。' },
] as const

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
].map((value) => ({
  value,
  label: value,
}))

const qwenTtsFormatOptions = [
  { value: 'wav', label: 'wav', note: '阿里侧默认更稳。' },
  { value: 'mp3', label: 'mp3', note: '文件更小。' },
] as const

const naturalFileNameCollator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
})
const defaultOpenAiProxyUrl = '127.0.0.1:7892'

const aliyunRegionOptions = [{ value: 'cn-hangzhou', label: 'cn-hangzhou', note: '当前项目适配的 OCR 地域。' }] as const
const aliyunOcrTypeOptions = [{ value: 'Advanced', label: 'Advanced', note: '当前项目只保留教材页 OCR 所需能力。' }] as const
const speakingPassScoreOptions: SpeakingPassScore[] = [60, 65, 70, 75]
const USERS_PAGE_SIZE = 8

const normalizePricing = (pricing?: ProviderPricing): ProviderPricing => ({
  text: pricing?.text || {},
  speech: pricing?.speech || {},
  tts: pricing?.tts || {},
  ocr: pricing?.ocr || {},
})

const normalizeOpenAIProviderForm = (form: ProviderSetting): ProviderSetting => ({
  ...form,
  apiMode: 'responses',
  model: openAiModelOptions.some((option) => option.value === form.model) ? form.model : 'gpt-5.2',
  baseUrl: 'https://api.openai.com/v1',
  endpoint: '',
  proxyUrl: typeof form.proxyUrl === 'string' ? form.proxyUrl.trim() : defaultOpenAiProxyUrl,
  reasoningEffort: openAiReasoningOptions.some((option) => option.value === form.reasoningEffort) ? form.reasoningEffort : 'high',
  verbosity: openAiVerbosityOptions.some((option) => option.value === form.verbosity) ? form.verbosity : 'medium',
  maxOutputTokens: openAiMaxOutputTokenOptions.some((value) => value === form.maxOutputTokens) ? form.maxOutputTokens : 2048,
  speechModel: openAiSpeechModelOptions.some((option) => option.value === form.speechModel) ? form.speechModel : 'gpt-4o-mini-transcribe',
  ttsModel: openAiTtsModelOptions.some((option) => option.value === form.ttsModel) ? form.ttsModel : 'gpt-4o-mini-tts',
  ttsVoice: openAiTtsVoiceOptions.some((option) => option.value === form.ttsVoice) ? form.ttsVoice : 'alloy',
  ttsFormat: openAiTtsFormatOptions.some((option) => option.value === form.ttsFormat) ? form.ttsFormat : 'mp3',
  ttsInstructions:
    typeof form.ttsInstructions === 'string' && form.ttsInstructions.trim()
      ? form.ttsInstructions.trim()
      : 'Read in a warm, patient classroom voice for primary-school English learners.',
  ocrModel: openAiModelOptions.some((option) => option.value === form.ocrModel) ? form.ocrModel : form.model || 'gpt-5.2',
  pricing: normalizePricing(form.pricing),
})

const normalizeQwenProviderForm = (form: ProviderSetting): ProviderSetting => ({
  ...form,
  apiMode: qwenApiModeOptions.some((option) => option.value === form.apiMode) ? form.apiMode : 'native',
  model: qwenModelOptions.some((option) => option.value === form.model) ? form.model : 'qwen-plus',
  baseUrl: 'https://dashscope.aliyuncs.com',
  temperature: qwenTemperatureOptions.some((option) => option.value === form.temperature) ? form.temperature : 0.2,
  maxOutputTokens: qwenMaxTokenOptions.some((value) => value === form.maxOutputTokens) ? form.maxOutputTokens : 2048,
  speechModel: qwenSpeechModelOptions.some((option) => option.value === form.speechModel) ? form.speechModel : 'qwen3-asr-flash',
  ttsModel: qwenTtsModelOptions.some((option) => option.value === form.ttsModel) ? form.ttsModel : 'qwen3-tts-flash',
  ttsVoice: qwenTtsVoiceOptions.some((option) => option.value === form.ttsVoice) ? form.ttsVoice : 'Cherry',
  ttsLanguageType: typeof form.ttsLanguageType === 'string' && form.ttsLanguageType.trim() ? form.ttsLanguageType.trim() : 'English',
  ttsFormat: qwenTtsFormatOptions.some((option) => option.value === form.ttsFormat) ? form.ttsFormat : 'wav',
  ttsInstructions: typeof form.ttsInstructions === 'string' ? form.ttsInstructions : '',
  pricing: normalizePricing(form.pricing),
})

const getGenerationProgressPercent = (job: GenerationJob | null) => {
  if (!job) {
    return 0
  }
  if (job.status === 'failed') {
    return 100
  }
  if (job.stage === 'completed' || job.status === 'success') {
    return 100
  }
  if (job.stage === 'draft') {
    return 88
  }
  if (job.stage === 'ocr') {
    const total = Math.max(job.totalImages, 1)
    return Math.min(80, Math.round((job.processedImages / total) * 80))
  }

  return 8
}

const getGenerationProgressHint = (job: GenerationJob | null) => {
  if (!job) {
    return ''
  }
  if (job.message) {
    return job.message
  }
  if (job.stage === 'draft') {
    return '正在生成单元草稿。'
  }
  if (job.stage === 'ocr') {
    return `正在识别教材图片（${job.processedImages}/${job.totalImages}）。`
  }
  return '正在准备生成任务。'
}

const normalizeAliyunOcrProviderForm = (form: ProviderSetting): ProviderSetting => ({
  ...form,
  apiMode: 'sdk',
  model: 'RecognizeAllText',
  regionId: aliyunRegionOptions.some((option) => option.value === form.regionId) ? form.regionId : 'cn-hangzhou',
  ocrType: aliyunOcrTypeOptions.some((option) => option.value === form.ocrType) ? form.ocrType : 'Advanced',
  pricing: normalizePricing(form.pricing),
})

const speakLine = (line: string) => {
  if (!('speechSynthesis' in window)) {
    return
  }
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(line))
}

const moveQueueItem = (queue: string[], targetId: string, direction: -1 | 1) => {
  const currentIndex = queue.indexOf(targetId)
  const nextIndex = currentIndex + direction
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= queue.length) {
    return queue
  }

  const nextQueue = [...queue]
  const [item] = nextQueue.splice(currentIndex, 1)
  nextQueue.splice(nextIndex, 0, item)
  return nextQueue
}

const reorderQueueItem = (queue: string[], draggedId: string, targetId: string, position: QueueDropPosition) => {
  if (!draggedId || draggedId === targetId) {
    return queue
  }

  const nextQueue = queue.filter((item) => item !== draggedId)
  const targetIndex = nextQueue.indexOf(targetId)
  if (targetIndex < 0) {
    return queue
  }

  nextQueue.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, draggedId)
  return nextQueue
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

const getAudioFormatInfo = (mimeType = '', fileName = '') => {
  const normalizedMimeType = mimeType.toLowerCase()
  const normalizedFileName = fileName.toLowerCase()

  if (normalizedMimeType.includes('webm')) {
    return { mimeType: 'audio/webm', extension: 'webm' }
  }

  if (
    normalizedMimeType.includes('mp4') ||
    normalizedMimeType.includes('m4a') ||
    normalizedMimeType.includes('aac') ||
    normalizedFileName.endsWith('.m4a') ||
    normalizedFileName.endsWith('.mp4')
  ) {
    return { mimeType: 'audio/mp4', extension: 'm4a' }
  }

  if (
    normalizedMimeType.includes('mpeg') ||
    normalizedMimeType.includes('mp3') ||
    normalizedFileName.endsWith('.mp3') ||
    normalizedFileName.endsWith('.mpeg')
  ) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' }
  }

  if (
    normalizedMimeType.includes('wav') ||
    normalizedMimeType.includes('wave') ||
    normalizedFileName.endsWith('.wav')
  ) {
    return { mimeType: 'audio/wav', extension: 'wav' }
  }

  if (
    normalizedMimeType.includes('ogg') ||
    normalizedMimeType.includes('opus') ||
    normalizedFileName.endsWith('.ogg') ||
    normalizedFileName.endsWith('.opus')
  ) {
    return { mimeType: 'audio/ogg', extension: 'ogg' }
  }

  if (normalizedFileName.endsWith('.webm')) {
    return { mimeType: 'audio/webm', extension: 'webm' }
  }

  if (normalizedFileName.endsWith('.m4a') || normalizedFileName.endsWith('.mp4')) {
    return { mimeType: 'audio/mp4', extension: 'm4a' }
  }

  if (normalizedFileName.endsWith('.mp3') || normalizedFileName.endsWith('.mpeg')) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' }
  }

  if (normalizedFileName.endsWith('.wav')) {
    return { mimeType: 'audio/wav', extension: 'wav' }
  }

  if (normalizedFileName.endsWith('.ogg') || normalizedFileName.endsWith('.opus')) {
    return { mimeType: 'audio/ogg', extension: 'ogg' }
  }

  return { mimeType: 'audio/webm', extension: 'webm' }
}

const getPreferredRecordingMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ''
}

const formatHistoryTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

const formatDurationLabel = (durationSeconds: number) => {
  if (durationSeconds >= 3600) {
    const hours = Math.floor(durationSeconds / 3600)
    const minutes = Math.max(1, Math.round((durationSeconds % 3600) / 60))
    return `${hours}小时${minutes}分钟`
  }

  const minutes = Math.max(1, Math.round(durationSeconds / 60))
  return `${minutes}分钟`
}

const getResultAnchorId = (unitId: string, activityId: string) => `result-stars:${unitId}:${activityId}`
const getSpeakingHistoryAnchorId = (historyId: string) => `speaking-history-stars:${historyId}`

const getBestSpeakingHistoryEntry = (entries: SpeakingRecording[]) =>
  [...entries].sort((left, right) => {
    const leftScore = left.score ?? -1
    const rightScore = right.score ?? -1
    if (rightScore !== leftScore) {
      return rightScore - leftScore
    }
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })[0] || null

const EyeToggleIcon = ({ visible }: { visible: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d={
        visible
          ? 'M12 5C6.5 5 2.1 8.3 1 12c1.1 3.7 5.5 7 11 7s9.9-3.3 11-7c-1.1-3.7-5.5-7-11-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z'
          : 'm3.3 2 18.7 18.7-1.4 1.4-3.1-3.1A13 13 0 0 1 12 19c-5.5 0-9.9-3.3-11-7 .5-1.7 1.7-3.3 3.4-4.6L1.9 4.8 3.3 3.4Zm5.2 5.2 1.7 1.7a2 2 0 0 0 2.6 2.6l1.7 1.7A4.9 4.9 0 0 1 12 16a5 5 0 0 1-5-5c0-1 .3-2 .8-2.8Zm7.2 7.2-1.5-1.5c2-.8 3.6-2.3 4.4-4.1-.9-1.8-2.5-3.3-4.5-4.1-1-.4-2-.6-3.1-.6-.8 0-1.5.1-2.2.3L7.5 5.8c1.4-.5 2.9-.8 4.5-.8 5.5 0 9.9 3.3 11 7-.9 2.9-3.8 5.6-7.3 6.2ZM12 8a4 4 0 0 1 4 4c0 .5-.1 1-.3 1.5l-5.2-5.2c.5-.2 1-.3 1.5-.3Z'
      }
    />
  </svg>
)

function App() {
  const [progressReady, setProgressReady] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [progress, setProgress] = useState<StudentProgress>(createDefaultProgress([]))
  const [userSession, setUserSession] = useState<UserSession>({
    authenticated: false,
    user: null,
  })
  const [adminSession, setAdminSession] = useState<AdminSession>({
    bootstrapped: false,
    authenticated: false,
    username: null,
  })
  const [adminState, setAdminState] = useState<AdminState>({
    subjects: [],
    drafts: [],
    projectSettings: { activeAiVendor: 'openai', speakingPassScore: 60 },
    providerSettings: [],
    usageLogs: [],
    users: [],
  })
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>({ activeAiVendor: 'openai', speakingPassScore: 60 })
  const [view, setView] = useState<ViewName>('login')
  const [adminTab, setAdminTab] = useState<AdminTab>('subjects')
  const [activeUnitId, setActiveUnitId] = useState('')
  const [activeActivityIndex, setActiveActivityIndex] = useState(0)
  const [choiceAnswer, setChoiceAnswer] = useState('')
  const [wrongChoiceAnswer, setWrongChoiceAnswer] = useState('')
  const [choiceWrongAttempts, setChoiceWrongAttempts] = useState(0)
  const [warmupSeenCardIds, setWarmupSeenCardIds] = useState<string[]>([])
  const [textAnswer, setTextAnswer] = useState('')
  const [challengeAnswers, setChallengeAnswers] = useState<Record<string, string>>({})
  const [challengeWrongAnswers, setChallengeWrongAnswers] = useState<Record<string, string>>({})
  const [challengeWrongCounts, setChallengeWrongCounts] = useState<Record<string, number>>({})
  const [challengeCorrectIds, setChallengeCorrectIds] = useState<Record<string, boolean>>({})
  const [speakingLoading, setSpeakingLoading] = useState(false)
  const [submission, setSubmission] = useState<SubmissionState>({ status: 'idle' })
  const [infoMessage, setInfoMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [selectedDraftId, setSelectedDraftId] = useState('')
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [bootstrapForm, setBootstrapForm] = useState({ username: '', password: '' })
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [userLoginForm, setUserLoginForm] = useState({ username: '', password: '' })
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [subjectForm, setSubjectForm] = useState({ name: '', description: '' })
  const [userForm, setUserForm] = useState({ username: '', displayName: '', password: '', subjectId: '' })
  const [userSearch, setUserSearch] = useState('')
  const [userListPage, setUserListPage] = useState(1)
  const [createUserNameError, setCreateUserNameError] = useState('')
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false)
  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false)
  const [resetPasswordTarget, setResetPasswordTarget] = useState<User | null>(null)
  const [deleteConfirmModalOpen, setDeleteConfirmModalOpen] = useState(false)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<User | null>(null)
  const [subjectModalOpen, setSubjectModalOpen] = useState(false)
  const [subjectModalTarget, setSubjectModalTarget] = useState<User | null>(null)
  const [subjectModalValue, setSubjectModalValue] = useState('')
  const [userResetPassword, setUserResetPassword] = useState('')
  const [createUserPasswordVisible, setCreateUserPasswordVisible] = useState(false)
  const [resetUserPasswordVisible, setResetUserPasswordVisible] = useState(false)
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})
  const [providerForms, setProviderForms] = useState<Record<string, ProviderSetting>>({})
  const [draftGenerationJob, setDraftGenerationJob] = useState<GenerationJob | null>(null)
  const [draggedQueueImageId, setDraggedQueueImageId] = useState('')
  const [previewImageId, setPreviewImageId] = useState('')
  const [lessonAudioFeedback, setLessonAudioFeedback] = useState<{ activityId: string; tone: 'info' | 'warning'; text: string } | null>(null)
  const [secretVisibility, setSecretVisibility] = useState<Record<SecretFieldId, boolean>>({
    'openai-api-key': false,
    'qwen-api-key': false,
    'aliyun-access-key-id': false,
    'aliyun-access-key-secret': false,
  })
  const [speakingRecorderState, setSpeakingRecorderState] = useState<'idle' | 'recording' | 'uploading' | 'recorded'>('idle')
  const [speakingRecorderError, setSpeakingRecorderError] = useState('')
  const [speakingSubmitError, setSpeakingSubmitError] = useState('')
  const [speakingSubmitErrorHistoryId, setSpeakingSubmitErrorHistoryId] = useState('')
  const [speakingHistory, setSpeakingHistory] = useState<SpeakingRecording[]>([])
  const [currentSpeakingHistoryId, setCurrentSpeakingHistoryId] = useState('')
  const [speakingHistorySubmittingId, setSpeakingHistorySubmittingId] = useState('')
  const [rewardAnimation, setRewardAnimation] = useState<{ key: number; stars: number; anchorId: string } | null>(null)
  const [pendingRewardAnchorId, setPendingRewardAnchorId] = useState('')
  const [feedbackAudioPrimed, setFeedbackAudioPrimed] = useState(false)
  const lessonStartedAt = useRef(Date.now())
  const lessonStageRef = useRef<HTMLElement | null>(null)
  const resultCardRef = useRef<HTMLDivElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaChunksRef = useRef<Blob[]>([])
  const successAudioRef = useRef<HTMLAudioElement | null>(null)
  const errorAudioRef = useRef<HTMLAudioElement | null>(null)
  const rewardHideTimerRef = useRef<number | null>(null)
  const rewardStartTimerRef = useRef<number | null>(null)
  const lessonAudioRef = useRef<HTMLAudioElement | null>(null)

  const publishedUnits = units.filter((unit) => unit.status === 'published')
  const activeUnit = publishedUnits.find((unit) => unit.id === activeUnitId) ?? publishedUnits[0]
  const activeActivity = activeUnit?.activities[activeActivityIndex]
  const currentSubject = subjects.find((subject) => subject.id === selectedSubjectId) || subjects[0]
  const currentAdminSubject =
    adminState.subjects.find((subject) => subject.id === selectedSubjectId) || adminState.subjects[0]
  const currentAdminSubjectName = currentAdminSubject?.name || ''
  const sortedAdminImages = [...(currentAdminSubject?.images || [])].sort((left, right) =>
    naturalFileNameCollator.compare(left.fileName, right.fileName),
  )
  const previewImageIndex = previewImageId ? sortedAdminImages.findIndex((image) => image.id === previewImageId) : -1
  const previewImage = previewImageIndex >= 0 ? sortedAdminImages[previewImageIndex] : null
  const selectedImageQueue = selectedImageIds
    .map((imageId) => sortedAdminImages.find((image) => image.id === imageId))
    .filter((image): image is SubjectImage => Boolean(image))
  const allAdminImagesSelected = Boolean(sortedAdminImages.length) && selectedImageIds.length === sortedAdminImages.length
  const selectedDraft =
    adminState.drafts.find((draft) => draft.id === selectedDraftId) || adminState.drafts[0] || null
  const draftGenerationSubjectName =
    adminState.subjects.find((subject) => subject.id === draftGenerationJob?.subjectId)?.name || currentAdminSubjectName
  const filteredUsers = adminState.users.filter((user) => user.username.toLowerCase().includes(userSearch.trim().toLowerCase()))
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE))
  const paginatedUsers = filteredUsers.slice((userListPage - 1) * USERS_PAGE_SIZE, userListPage * USERS_PAGE_SIZE)
  const activeSubjects = adminState.subjects.filter((subject) => subject.status === 'active')
  const activeAiVendor = projectSettings.activeAiVendor
  const speakingPassScore = projectSettings.speakingPassScore
  const todayStudySummary = getTodayStudySummary(progress, speakingPassScore)
  const perfectUnitIds = getPerfectUnitIds(progress.activityResults, publishedUnits, speakingPassScore)
  const perfectUnitIdSet = new Set(perfectUnitIds)
  const openAiForm = providerForms.openai
  const qwenForm = providerForms.qwen
  const aliyunOcrForm = providerForms['aliyun-ocr']
  const recommendation = getRecommendation(progress, publishedUnits, speakingPassScore)
  const activeActivityResult = activeUnit && activeActivity ? progress.activityResults[`${activeUnit.id}:${activeActivity.id}`] : null
  const activeActivityStars =
    activeUnit && activeActivity ? getActivityStars(progress.activityResults, activeUnit.id, activeActivity.id, speakingPassScore) : 0
  const activeActivityLocked = activeActivityStars === 3
  const activeChallengeLocked = activeActivity?.kind === 'challenge' && Boolean(activeActivityResult?.completed)
  const activeActivityReadOnly = activeChallengeLocked || activeActivityLocked

  const hydrateAppData = useCallback((appData: AppData & { bootstrapped?: boolean }) => {
    setBootstrapped(Boolean(appData.bootstrapped))
    setSubjects(appData.subjects || [])
    setUnits(appData.units)
    setProjectSettings(appData.projectSettings || { activeAiVendor: 'openai', speakingPassScore: 60 })
    setProgress(appData.progress)
    setProgressReady(true)
    setActiveUnitId(appData.progress.currentUnitId || appData.units[0]?.id || '')
    if (appData.currentUser) {
      setUserSession({
        authenticated: true,
        user: appData.currentUser,
      })
    }
  }, [])

  const refreshPublicData = useCallback(async () => {
    if (!userSession.authenticated) {
      return
    }
    const publicData = await getPublicAppData()
    hydrateAppData(publicData)
  }, [hydrateAppData, userSession.authenticated])

  const refreshAdminState = useCallback(async () => {
    const state = await getAdminState()
    setAdminState(state)
    setProjectSettings(state.projectSettings)
    if (!selectedSubjectId && state.subjects[0]) {
      setSelectedSubjectId(state.subjects[0].id)
    }
  }, [selectedSubjectId])

  useEffect(() => {
    const init = async () => {
      try {
        const [admin, user] = await Promise.all([getAdminSession(), getUserSession()])
        setAdminSession(admin)
        setBootstrapped(admin.bootstrapped)
        setUserSession(user)
        if (user.authenticated) {
          const appData = await getPublicAppData()
          hydrateAppData(appData)
          setView('home')
          setSelectedSubjectId(appData.subjects?.[0]?.id || '')
        } else {
          setProgressReady(true)
          setView('login')
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '初始化失败')
      }
    }

    init()
  }, [hydrateAppData])

  useEffect(() => {
    const nextPublishedUnits = units.filter((unit) => unit.status === 'published')
    if (!progressReady || !nextPublishedUnits.length) {
      return
    }

    setProgress((current) => syncProgressDerivedState(current, nextPublishedUnits, speakingPassScore))
  }, [units, progressReady, speakingPassScore])

  useEffect(() => {
    if (!adminSession.authenticated) {
      return
    }

    refreshAdminState()
  }, [adminSession.authenticated, refreshAdminState])

  useEffect(() => {
    if (publishedUnits.length && !publishedUnits.find((unit) => unit.id === activeUnitId)) {
      setActiveUnitId(publishedUnits[0].id)
    }
  }, [publishedUnits, activeUnitId])

  useEffect(() => {
    if (!selectedDraftId && adminState.drafts[0]) {
      setSelectedDraftId(adminState.drafts[0].id)
    }
  }, [adminState.drafts, selectedDraftId])

  useEffect(() => {
    setUserListPage(1)
  }, [userSearch])

  useEffect(() => {
    if (userListPage > userPageCount) {
      setUserListPage(userPageCount)
    }
  }, [userListPage, userPageCount])

  useEffect(() => {
    const nextForms = adminState.providerSettings.reduce<Record<string, ProviderSetting>>((acc, setting) => {
      if (setting.provider === 'openai') {
        acc[setting.provider] = normalizeOpenAIProviderForm(setting)
      } else if (setting.provider === 'qwen') {
        acc[setting.provider] = normalizeQwenProviderForm(setting)
      } else {
        acc[setting.provider] = normalizeAliyunOcrProviderForm(setting)
      }
      return acc
    }, {})
    setProviderForms(nextForms)
  }, [adminState.providerSettings])

  useEffect(() => {
    if (typeof Audio === 'undefined') {
      return
    }

    successAudioRef.current = new Audio('/audio/good.m4a')
    errorAudioRef.current = new Audio('/audio/think.mp4')
    successAudioRef.current.preload = 'auto'
    errorAudioRef.current.preload = 'auto'
  }, [])

  useEffect(() => {
    return () => {
      if (rewardHideTimerRef.current) {
        window.clearTimeout(rewardHideTimerRef.current)
      }
      if (rewardStartTimerRef.current) {
        window.clearTimeout(rewardStartTimerRef.current)
      }
      if (lessonAudioRef.current) {
        lessonAudioRef.current.pause()
        lessonAudioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const currentImageIdSet = new Set((currentAdminSubject?.images || []).map((image) => image.id))
    setSelectedImageIds((current) => current.filter((imageId) => currentImageIdSet.has(imageId)))
  }, [currentAdminSubject])

  useEffect(() => {
    if (!previewImageId) {
      return
    }

    const nextImageExists = (currentAdminSubject?.images || []).some((image) => image.id === previewImageId)
    if (!nextImageExists) {
      setPreviewImageId('')
    }
  }, [currentAdminSubject, previewImageId])

  useEffect(() => {
    setLessonAudioFeedback(null)
  }, [activeActivity?.id])

  useEffect(() => {
    let lastTouchEndAt = 0
    const preventGesture = (event: Event) => {
      event.preventDefault()
    }
    const preventTouchZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault()
      }
    }
    const preventDoubleTapZoom = (event: TouchEvent) => {
      const now = Date.now()
      if (now - lastTouchEndAt < 320) {
        event.preventDefault()
      }
      lastTouchEndAt = now
    }

    document.addEventListener('gesturestart', preventGesture, { passive: false })
    document.addEventListener('gesturechange', preventGesture, { passive: false })
    document.addEventListener('gestureend', preventGesture, { passive: false })
    document.addEventListener('touchmove', preventTouchZoom, { passive: false })
    document.addEventListener('touchend', preventDoubleTapZoom, { passive: false })

    return () => {
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
      document.removeEventListener('gestureend', preventGesture)
      document.removeEventListener('touchmove', preventTouchZoom)
      document.removeEventListener('touchend', preventDoubleTapZoom)
    }
  }, [])

  useEffect(() => {
    if (!userSession.authenticated || !activeUnit || activeActivity?.kind !== 'speak-repeat') {
      setSpeakingHistory([])
      setCurrentSpeakingHistoryId('')
      return
    }
    let cancelled = false
    void getSpeakingRecordings(activeUnit.id, activeActivity.id)
      .then((entries) => {
        if (cancelled) {
          return
        }
        setSpeakingHistory(entries)
        setCurrentSpeakingHistoryId(getBestSpeakingHistoryEntry(entries)?.id || entries[0]?.id || '')
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setSpeakingHistory([])
        setSpeakingRecorderError(error instanceof Error ? error.message : '录音历史加载失败')
      })

    return () => {
      cancelled = true
    }
  }, [activeUnit, activeActivity?.id, activeActivity?.kind, userSession.authenticated])

  useEffect(() => {
    if (activeActivity?.kind !== 'speak-repeat' || !activeActivityLocked || !speakingHistory.length) {
      return
    }

    const bestEntry = getBestSpeakingHistoryEntry(speakingHistory)
    if (bestEntry?.id) {
      setCurrentSpeakingHistoryId(bestEntry.id)
    }
  }, [activeActivity?.kind, activeActivityLocked, speakingHistory])

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        view,
        activeUnitId,
        activeActivityId: activeActivity?.id || null,
        totalStars: progress.totalStars,
        bootstrapped,
        adminAuthenticated: adminSession.authenticated,
      })
    window.advanceTime = async (ms: number) => wait(Math.min(ms, 200))
    return () => {
      window.render_game_to_text = undefined
      window.advanceTime = undefined
    }
  }, [view, activeUnitId, activeActivity?.id, progress.totalStars, bootstrapped, adminSession.authenticated])

  useEffect(() => () => {
    disposeSpeakingRecorder()
  }, [])

  const clearUserLearningState = useCallback((message?: string) => {
    setUserSession({ authenticated: false, user: null })
    setSubjects([])
    setUnits([])
    setProgress(createDefaultProgress([]))
    setSpeakingHistory([])
    setCurrentSpeakingHistoryId('')
    setView('login')
    if (message) {
      setInfoMessage(message)
    }
  }, [])

  useEffect(() => {
    if (!userSession.authenticated) {
      return
    }

    let cancelled = false
    const syncSession = async () => {
      try {
        const latestSession = await getUserSession()
        if (cancelled) {
          return
        }
        if (!latestSession.authenticated) {
          clearUserLearningState('当前学科已更新，请重新登录。')
        }
      } catch {
        // Ignore polling errors and keep the current session state.
      }
    }

    const intervalId = window.setInterval(() => {
      void syncSession()
    }, 15000)
    const handleFocus = () => {
      void syncSession()
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
    }
  }, [clearUserLearningState, userSession.authenticated])

  const setBusy = (key: string, value: boolean) => {
    setBusyMap((current) => ({ ...current, [key]: value }))
  }

  const openImagePreview = (imageId: string) => {
    if (!sortedAdminImages.some((image) => image.id === imageId)) {
      return
    }
    setPreviewImageId(imageId)
  }

  const movePreviewImage = (direction: -1 | 1) => {
    if (previewImageIndex < 0) {
      return
    }

    const nextIndex = previewImageIndex + direction
    if (nextIndex < 0 || nextIndex >= sortedAdminImages.length) {
      return
    }

    setPreviewImageId(sortedAdminImages[nextIndex].id)
  }

  const playLessonAudio = async (activityId: string, audioUrl?: string, fallbackText?: string) => {
    if (audioUrl && typeof Audio !== 'undefined') {
      try {
        if (!lessonAudioRef.current) {
          lessonAudioRef.current = new Audio()
        }
        lessonAudioRef.current.pause()
        lessonAudioRef.current.src = audioUrl
        lessonAudioRef.current.currentTime = 0
        await lessonAudioRef.current.play()
        setLessonAudioFeedback({
          activityId,
          tone: 'info',
          text: '当前播放的是预生成标准音频。',
        })
        return
      } catch {
        setLessonAudioFeedback({
          activityId,
          tone: 'warning',
          text: '标准音频加载失败，已回退到浏览器朗读。',
        })
      }
    }

    if (fallbackText) {
      if (!audioUrl) {
        setLessonAudioFeedback({
          activityId,
          tone: 'warning',
          text: '这条内容当前没有预生成音频，正在使用浏览器朗读。',
        })
      }
      speakLine(fallbackText)
    }
  }

  const moveSelectedImage = (imageId: string, direction: -1 | 1) => {
    setSelectedImageIds((current) => moveQueueItem(current, imageId, direction))
  }

  const handleQueueDrop = (targetId: string, position: QueueDropPosition) => {
    if (!draggedQueueImageId) {
      return
    }

    setSelectedImageIds((current) => reorderQueueItem(current, draggedQueueImageId, targetId, position))
    setDraggedQueueImageId('')
  }

  const toggleSecretVisibility = (fieldId: SecretFieldId) => {
    setSecretVisibility((current) => ({
      ...current,
      [fieldId]: !current[fieldId],
    }))
  }

  const disposeSpeakingRecorder = () => {
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
      mediaRecorderRef.current = null
    }

    const stream = mediaStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    mediaChunksRef.current = []
  }

  const playFeedbackSound = async (isCorrect: boolean, options: { rewardStars?: number; rewardAnchorId?: string } = {}) => {
    const audio = isCorrect ? successAudioRef.current : errorAudioRef.current
    if (!audio) {
      if (isCorrect && options.rewardStars && options.rewardStars > 0 && options.rewardAnchorId) {
        triggerRewardAnimation(options.rewardStars, options.rewardAnchorId)
      }
      return
    }

    try {
      audio.currentTime = 0
      if (isCorrect && options.rewardStars && options.rewardStars > 0 && options.rewardAnchorId) {
        setPendingRewardAnchorId(options.rewardAnchorId)
        if (rewardStartTimerRef.current) {
          window.clearTimeout(rewardStartTimerRef.current)
        }
        const durationSeconds = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0.52
        const halfDelay = Math.max(140, Math.min(700, Math.round(durationSeconds * 500)))
        rewardStartTimerRef.current = window.setTimeout(() => {
          setPendingRewardAnchorId('')
          triggerRewardAnimation(options.rewardStars || 0, options.rewardAnchorId || '')
          rewardStartTimerRef.current = null
        }, halfDelay)
      }
      await audio.play()
    } catch {
      setPendingRewardAnchorId('')
      if (isCorrect && options.rewardStars && options.rewardStars > 0 && options.rewardAnchorId) {
        triggerRewardAnimation(options.rewardStars, options.rewardAnchorId)
      }
      // Ignore autoplay failures triggered by browser policy differences.
    }
  }

  const prewarmFeedbackAudio = async () => {
    if (feedbackAudioPrimed) {
      return
    }

    const audios = [successAudioRef.current, errorAudioRef.current].filter(Boolean) as HTMLAudioElement[]
    for (const audio of audios) {
      try {
        audio.load()
      } catch {
        // Ignore preload differences across browsers.
      }
    }

    setFeedbackAudioPrimed(true)
  }

  const getChoiceScoreFromWrongAttempts = (wrongAttempts: number) => {
    if (wrongAttempts <= 0) {
      return 100
    }
    if (wrongAttempts === 1) {
      return 80
    }
    return speakingPassScore
  }

  const triggerRewardAnimation = (stars: number, anchorId: string) => {
    if (!stars || !anchorId) {
      return
    }
    if (rewardHideTimerRef.current) {
      window.clearTimeout(rewardHideTimerRef.current)
    }

    setRewardAnimation({ key: Date.now(), stars, anchorId })
    rewardHideTimerRef.current = window.setTimeout(() => {
      setRewardAnimation(null)
      rewardHideTimerRef.current = null
    }, 1500)
  }

  const resetTransientState = () => {
    disposeSpeakingRecorder()
    if (rewardStartTimerRef.current) {
      window.clearTimeout(rewardStartTimerRef.current)
      rewardStartTimerRef.current = null
    }
    if (rewardHideTimerRef.current) {
      window.clearTimeout(rewardHideTimerRef.current)
      rewardHideTimerRef.current = null
    }
    setRewardAnimation(null)
    setPendingRewardAnchorId('')
    setChoiceAnswer('')
    setWrongChoiceAnswer('')
    setChoiceWrongAttempts(0)
    setWarmupSeenCardIds([])
    setTextAnswer('')
    setChallengeAnswers({})
    setChallengeWrongAnswers({})
    setChallengeWrongCounts({})
    setChallengeCorrectIds({})
    setSpeakingRecorderError('')
    setSpeakingSubmitError('')
    setSpeakingSubmitErrorHistoryId('')
    setSpeakingRecorderState('idle')
    setCurrentSpeakingHistoryId('')
    setSpeakingHistorySubmittingId('')
    setSubmission({ status: 'idle' })
    lessonStartedAt.current = Date.now()
  }

  const scrollLessonStageIntoView = (behavior: ScrollBehavior = 'smooth') => {
    if (!window.matchMedia('(max-width: 1024px)').matches) {
      return
    }

    window.setTimeout(() => {
      lessonStageRef.current?.scrollIntoView({ behavior, block: 'start' })
    }, 40)
  }

  const scrollResultIntoView = (behavior: ScrollBehavior = 'smooth') => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        resultCardRef.current?.scrollIntoView({ behavior, block: 'start' })
      })
    }, 40)
  }

  const updateSpeakingHistoryEntries = (entries: SpeakingRecording[]) => {
    setSpeakingHistory(entries)
  }

  const renderPersistentStars = (
    stars: number,
    anchorId: string,
    label = `${stars} 星`,
    options?: { maxStars?: number; dimRemaining?: boolean },
  ) => {
    if (stars <= 0) {
      return null
    }

    const maxStars = Math.max(stars, options?.maxStars || stars)
    const animating = rewardAnimation?.anchorId === anchorId
    const hiddenForReward = pendingRewardAnchorId === anchorId || animating
    const displaySlots = Array.from({ length: maxStars }, (_, index) => {
      const filled = index < stars
      return (
        <span key={`${anchorId}-${index}`} className={`persistent-star ${filled ? 'filled' : 'dimmed'}`} aria-hidden="true">
          {filled ? '⭐' : '☆'}
        </span>
      )
    })

    return (
      <span className="persistent-stars-anchor" data-anchor-id={anchorId}>
        <span className={`persistent-stars ${hiddenForReward ? 'animating' : ''}`} aria-label={label}>
          {displaySlots}
        </span>
        {animating ? (
          <span key={rewardAnimation.key} className="reward-anchor-burst" aria-hidden="true">
            <span className="reward-stars">
              {Array.from({ length: rewardAnimation.stars }, (_, index) => (
                <span key={`${rewardAnimation.key}-${index}`}>⭐</span>
              ))}
            </span>
          </span>
        ) : null}
      </span>
    )
  }

  const buildLockedSubmission = () => {
    if (!activeUnit || !activeActivity || !activeActivityResult || !activeActivityReadOnly || activeActivity.kind === 'speak-repeat') {
      return null
    }

    const resultScore = activeActivityResult.score
    const stars = getScoreStars(resultScore, speakingPassScore)
    const title =
      activeActivity.kind === 'challenge'
        ? '本关已经完成，直接查看最终结果。'
        : activeActivity.kind === 'write-spell'
          ? '本关已经满星完成，答案和结果已保留。'
          : '本关已经满星完成。'

    return {
      status: 'done' as const,
      score: resultScore,
      stars,
      title,
      mistakes: activeActivityResult.mistakes,
      completed: true,
    }
  }

  const lockedSubmission = buildLockedSubmission()
  const displayedSubmission = submission.status === 'done' ? submission : lockedSubmission || { status: 'idle' as const }

  const persistProgressToServer = async (nextProgress: StudentProgress) => {
    try {
      const saved = await saveUserProgress(nextProgress)
      setProgress(saved)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '学习进度同步失败')
    }
  }

  const handleSelectSpeakingHistory = (entry: SpeakingRecording) => {
    setSpeakingRecorderError('')
    setSpeakingSubmitError('')
    setCurrentSpeakingHistoryId(entry.id)
  }

  const handleDeleteSpeakingHistory = async (entryId: string) => {
    if (activeActivityLocked) {
      return
    }
    await deleteSpeakingRecording(entryId)
    const nextEntries = speakingHistory.filter((entry) => entry.id !== entryId)
    updateSpeakingHistoryEntries(nextEntries)
    if (speakingHistorySubmittingId === entryId) {
      setSpeakingHistorySubmittingId('')
    }
    if (currentSpeakingHistoryId === entryId) {
      setCurrentSpeakingHistoryId(getBestSpeakingHistoryEntry(nextEntries)?.id || nextEntries[0]?.id || '')
    }
  }

  const openUnit = (unitId: string, activityIndex = 0) => {
    startTransition(() => {
      setActiveUnitId(unitId)
      setActiveActivityIndex(activityIndex)
      setView('learn')
      resetTransientState()
    })
    scrollLessonStageIntoView('smooth')
  }

  const getCompletedActivityCount = (unit: Unit) =>
    unit.activities.filter((activity) => progress.activityResults[`${unit.id}:${activity.id}`]?.completed).length

  const getActivityStarCount = (unitId: string, activityId: string) => {
    return getActivityStars(progress.activityResults, unitId, activityId, speakingPassScore)
  }

  const handleWarmupCardActivate = (cardId: string, line: string) => {
    if (!activeActivity || activeActivity.kind !== 'warmup' || activeActivityLocked) {
      return
    }

    speakLine(line)
    setWarmupSeenCardIds((current) => {
      if (current.includes(cardId)) {
        return current
      }

      const next = [...current, cardId]
      if (next.length === activeActivity.cards.length) {
        window.setTimeout(() => {
          submitResult(100, [], '热身完成，进入正式任务。', { feedbackTone: 'success' })
        }, 0)
      }
      return next
    })
  }

  const submitResult = (
    score: number,
    mistakes: string[],
    title: string,
    options: { showResultCard?: boolean; feedbackTone?: 'success' | 'error'; rewardAnchorId?: string } = {},
  ) => {
    if (!activeUnit || !activeActivity) {
      return
    }
    const durationSeconds = Math.max(20, Math.round((Date.now() - lessonStartedAt.current) / 1000))
    const nextProgress = completeActivity(
      progress,
      publishedUnits,
      activeUnit,
      activeActivity,
      score,
      mistakes,
      durationSeconds,
      speakingPassScore,
    )
    const mergedResult = nextProgress.activityResults[`${activeUnit.id}:${activeActivity.id}`]
    const starGain = Math.max(0, nextProgress.totalStars - progress.totalStars)
    setProgress(nextProgress)
    void persistProgressToServer(nextProgress)
    if (options.showResultCard !== false) {
      setSubmission({
        status: 'done',
        score: mergedResult?.score ?? score,
        stars: mergedResult?.completed ? getScoreStars(mergedResult?.score ?? score, speakingPassScore) : 0,
        title: mergedResult?.completed && (mergedResult?.score ?? score) > score ? '已保留历史最高分，本关仍算通过。' : title,
        mistakes: mergedResult?.mistakes ?? mistakes,
        completed: Boolean(mergedResult?.completed),
      })
    } else {
      setSubmission({ status: 'idle' })
    }
    if (options.feedbackTone === 'success') {
      void prewarmFeedbackAudio()
      void playFeedbackSound(true, {
        rewardStars: starGain,
        rewardAnchorId: options.rewardAnchorId || getResultAnchorId(activeUnit.id, activeActivity.id),
      })
    } else if (options.feedbackTone === 'error') {
      void prewarmFeedbackAudio()
      void playFeedbackSound(false)
    }
    if (options.showResultCard !== false) {
      scrollResultIntoView()
    }
  }

  const handleSubmitActivity = () => {
    if (!activeActivity || activeActivityLocked) {
      return
    }
    if (activeActivity.kind === 'warmup') {
      submitResult(100, [], '热身完成，进入正式任务。', { feedbackTone: 'success' })
      return
    }
    if (activeActivity.kind === 'write-spell') {
      if (!textAnswer.trim()) return
      const correct = textAnswer.trim().toLowerCase() === activeActivity.answer.toLowerCase()
      submitResult(
        correct ? 100 : 0,
        correct ? [] : [`拼写：${activeActivity.answer}`],
        correct ? '拼写准确，书写关过关。' : `再留意一下拼写，正确答案是 ${activeActivity.answer}。`,
        { feedbackTone: correct ? 'success' : 'error' },
      )
      return
    }
  }

  const handleChoiceSelect = async (optionId: string) => {
    if (!activeActivity || activeActivityLocked || (activeActivity.kind !== 'listen-choice' && activeActivity.kind !== 'read-choice')) {
      return
    }
    if (submission.status === 'done') {
      return
    }

    await prewarmFeedbackAudio()
    setChoiceAnswer(optionId)
    const correct = optionId === activeActivity.correctOptionId
    if (!correct) {
      setWrongChoiceAnswer(optionId)
      setChoiceWrongAttempts((current) => current + 1)
      await playFeedbackSound(false)
      return
    }

    setWrongChoiceAnswer('')
    const wrongAttempts = choiceWrongAttempts
    const score = getChoiceScoreFromWrongAttempts(wrongAttempts)
    submitResult(
      score,
      wrongAttempts > 0 ? [`${activeActivity.kind === 'listen-choice' ? '听力选择' : '阅读理解'}：${activeActivity.question}`] : [],
      wrongAttempts > 0 ? '答对了，再接再厉。' : '回答正确，耳朵真灵。',
      { feedbackTone: 'success' },
    )
  }

  const handleChallengeSelect = async (questionId: string, optionId: string) => {
    if (!activeActivity || activeActivityReadOnly || activeActivity.kind !== 'challenge') {
      return
    }
    if (challengeCorrectIds[questionId]) {
      return
    }

    const question = activeActivity.questions.find((item) => item.id === questionId)
    if (!question) {
      return
    }

    await prewarmFeedbackAudio()
    const correct = optionId === question.correctOptionId
    if (!correct) {
      setChallengeWrongAnswers((current) => ({ ...current, [questionId]: optionId }))
      setChallengeWrongCounts((current) => ({ ...current, [questionId]: (current[questionId] || 0) + 1 }))
      await playFeedbackSound(false)
      return
    }

    const wrongAttempts = challengeWrongCounts[questionId] || 0
    const nextAnswers = { ...challengeAnswers, [questionId]: optionId }
    const nextCorrectIds = { ...challengeCorrectIds, [questionId]: true }

    setChallengeAnswers(nextAnswers)
    setChallengeCorrectIds(nextCorrectIds)
    setChallengeWrongAnswers((current) => ({ ...current, [questionId]: '' }))
    const allCorrect = activeActivity.questions.every((item) => nextCorrectIds[item.id])
    if (!allCorrect) {
      return
    }

    const questionScores = activeActivity.questions.map((item) =>
      getChoiceScoreFromWrongAttempts(item.id === questionId ? wrongAttempts : challengeWrongCounts[item.id] || 0),
    )
    const score = Math.round(questionScores.reduce((sum, value) => sum + value, 0) / questionScores.length)
    const mistakes = activeActivity.questions
      .filter((item) => (item.id === questionId ? wrongAttempts : challengeWrongCounts[item.id] || 0) > 0)
      .map((item) => `句型复习：${item.prompt}`)

    submitResult(
      score,
      mistakes,
      score === 100 ? '徽章到手，你已经完成本单元。' : '挑战完成，薄弱点已加入复习清单。',
      { feedbackTone: 'success' },
    )
  }

  const runSpeakingEvaluation = async ({ historyId }: { historyId: string }) => {
    if (!activeActivity || activeActivity.kind !== 'speak-repeat') {
      return
    }
    setSpeakingLoading(true)
    setSpeakingHistorySubmittingId(historyId)
    setSpeakingSubmitError('')
    setSpeakingSubmitErrorHistoryId('')
    try {
      const result = await evaluateSpeaking(historyId, activeActivity.transcript)
      setSpeakingRecorderError('')
      setSpeakingHistory((current) =>
        current.map((entry) =>
          entry.id === historyId
            ? {
                ...entry,
                transcript: result.transcript,
                normalizedTranscript: result.normalizedTranscript,
                normalizedTarget: result.normalizedTarget,
                score: result.score,
                passed: result.passed,
                feedback: result.feedback,
                mistakes: result.mistakes,
                submittedAt: new Date().toISOString(),
                errorMessage: '',
              }
            : entry,
        ),
      )
      setCurrentSpeakingHistoryId(historyId)
      submitResult(
        result.score,
        result.passed ? [] : [`句型跟读：${activeActivity.transcript}`],
        result.passed ? '口语关通过，继续下一站。' : '已经开口啦，再跟着示范练一遍。',
        {
          showResultCard: false,
          feedbackTone: result.passed ? 'success' : 'error',
          rewardAnchorId: getSpeakingHistoryAnchorId(historyId),
        },
      )
    } catch (error) {
      setSpeakingSubmitError(error instanceof Error ? error.message : '口语评分失败，请稍后重试。')
      setSpeakingSubmitErrorHistoryId(historyId)
      setSpeakingHistory((current) =>
        current.map((entry) =>
          entry.id === historyId
            ? {
                ...entry,
                errorMessage: error instanceof Error ? error.message : '口语评分失败，请稍后重试。',
              }
            : entry,
        ),
      )
    } finally {
      setSpeakingLoading(false)
      setSpeakingHistorySubmittingId('')
    }
  }

  const handleSubmitSpeakingHistory = async (entry: SpeakingRecording) => {
    if (entry.submittedAt || activeActivityLocked) {
      return
    }

    setCurrentSpeakingHistoryId(entry.id)
    await runSpeakingEvaluation({ historyId: entry.id })
  }

  const handleStartSpeakingRecording = async () => {
    if (activeActivity?.kind !== 'speak-repeat' || activeActivityLocked) {
      return
    }
    if (!window.isSecureContext) {
      setSpeakingRecorderError('录音需要 HTTPS 或 localhost 安全上下文。')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setSpeakingRecorderError('当前浏览器不支持录音。')
      return
    }

    disposeSpeakingRecorder()
    setSpeakingRecorderError('')
    setSpeakingSubmitError('')
    setCurrentSpeakingHistoryId('')
    setSpeakingRecorderState('idle')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMimeType = getPreferredRecordingMimeType()
      const recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream)

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      mediaChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setSpeakingRecorderError('录音失败，请重试。')
      }

      recorder.onstop = () => {
        const chunkMimeType = mediaChunksRef.current[0]?.type || ''
        const audioFormat = getAudioFormatInfo(recorder.mimeType || chunkMimeType || preferredMimeType)
        const blob = new Blob(mediaChunksRef.current, { type: audioFormat.mimeType })
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null

        if (!blob.size) {
          setSpeakingRecorderState('idle')
          setSpeakingRecorderError('没有采集到有效录音，请再试一次。')
          return
        }

        setSpeakingRecorderState('uploading')
        void (async () => {
          try {
            if (!activeUnit || activeActivity?.kind !== 'speak-repeat') {
              throw new Error('当前关卡不支持录音')
            }
            const file = new File([blob], `speaking.${audioFormat.extension}`, {
              type: audioFormat.mimeType,
            })
            const durationSeconds = Math.max(1, Math.round((Date.now() - lessonStartedAt.current) / 1000))
            const uploaded = await uploadSpeakingRecording(file, activeUnit.id, activeActivity.id, durationSeconds)
            setSpeakingHistory((current) => [uploaded, ...current.filter((entry) => entry.id !== uploaded.id)])
            setCurrentSpeakingHistoryId(uploaded.id)
            setSpeakingRecorderState('recorded')
          } catch (error) {
            setSpeakingRecorderState('idle')
            setSpeakingRecorderError(error instanceof Error ? error.message : '录音上传失败，请重试。')
          }
        })()
      }

      recorder.start()
      setSpeakingRecorderState('recording')
    } catch (error) {
      disposeSpeakingRecorder()
      setSpeakingRecorderError(error instanceof Error ? error.message : '无法打开麦克风')
      setSpeakingRecorderState('idle')
    }
  }

  const handleStopSpeakingRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      return
    }
    recorder.stop()
  }

  const goToNextActivity = () => {
    if (!activeUnit) return
    if (activeActivityIndex >= activeUnit.activities.length - 1) {
      setView('home')
      resetTransientState()
      return
    }
    setActiveActivityIndex((current) => current + 1)
    resetTransientState()
    scrollLessonStageIntoView('smooth')
  }

  const wrapAction = async (key: string, action: () => Promise<void>) => {
    setErrorMessage('')
    setInfoMessage('')
    setBusy(key, true)
    try {
      await action()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(key, false)
    }
  }

  const waitForGenerationJob = async (jobId: string) => {
    const deadline = Date.now() + 20 * 60 * 1000
    let pollingFailures = 0

    while (true) {
      let latestJob: GenerationJob
      try {
        latestJob = await getGenerationJob(jobId)
        pollingFailures = 0
      } catch (error) {
        pollingFailures += 1
        if (pollingFailures >= 3) {
          throw error
        }
        await wait(1200)
        continue
      }

      setDraftGenerationJob(latestJob)

      if (latestJob.status === 'success') {
        return latestJob
      }

      if (latestJob.status === 'failed') {
        throw new Error(latestJob.errorMessage || latestJob.message || '单元草稿生成失败')
      }

      if (Date.now() > deadline) {
        throw new Error('等待草稿生成结果超时，请稍后到草稿列表查看是否已完成。')
      }

      await wait(1200)
    }
  }

  const handleBootstrap = () =>
    wrapAction('bootstrap', async () => {
      await bootstrapAdmin(bootstrapForm.username, bootstrapForm.password)
      setInfoMessage('管理员初始化完成，请登录。')
      const session = await getAdminSession()
      setAdminSession(session)
      setBootstrapped(true)
      setView('admin')
    })

  const handleEntryLogin = () =>
    wrapAction('entry-login', async () => {
      try {
        const session = await loginUser(userLoginForm.username, userLoginForm.password)
        setUserSession(session)
        const appData = await getPublicAppData()
        hydrateAppData(appData)
        setUserLoginForm({ username: '', password: '' })
        setView('home')
        setInfoMessage(`欢迎回来，${session.user?.displayName || session.user?.username || '同学'}。`)
      } catch (userError) {
        try {
          await loginAdmin(userLoginForm.username, userLoginForm.password)
          const session = await getAdminSession()
          setAdminSession(session)
          await refreshAdminState()
          setUserLoginForm({ username: '', password: '' })
          setView('admin')
          setInfoMessage('管理员已登录。')
        } catch {
          throw userError
        }
      }
    })

  const handleUserLogout = () =>
    wrapAction('user-logout', async () => {
      await logoutUser()
      clearUserLearningState('已退出学习账号。')
    })

  const handleLogin = () =>
    wrapAction('login', async () => {
      await loginAdmin(loginForm.username, loginForm.password)
      const session = await getAdminSession()
      setAdminSession(session)
      await refreshAdminState()
      setView('admin')
      setInfoMessage('管理员已登录。')
    })

  const handleLogout = () =>
    wrapAction('logout', async () => {
      await logoutAdmin()
      setAdminSession(await getAdminSession())
      setView('login')
      setInfoMessage('已退出管理员后台。')
    })

  const handleChangePassword = () =>
    wrapAction('change-password', async () => {
      if (!passwordForm.currentPassword || !passwordForm.newPassword) {
        throw new Error('请输入当前密码和新密码')
      }
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        throw new Error('两次输入的新密码不一致')
      }

      await changeAdminPassword(passwordForm.currentPassword, passwordForm.newPassword)
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setInfoMessage('管理员密码已更新。')
    })

  const handleCreateSubject = () =>
    wrapAction('create-subject', async () => {
      await createSubject(subjectForm)
      await refreshAdminState()
      setSubjectForm({ name: '', description: '' })
      setInfoMessage('新学科已创建。')
    })

  const handleCreateUser = () =>
    wrapAction('create-user', async () => {
      setCreateUserNameError('')
      if (!userForm.username.trim() || !userForm.displayName.trim() || !userForm.password || !userForm.subjectId) {
        throw new Error('请输入登录名、姓名、初始密码和学科')
      }
      try {
        await createUser({
          username: userForm.username.trim(),
          displayName: userForm.displayName.trim(),
          password: userForm.password,
          subjectId: userForm.subjectId,
        })
      } catch (error) {
        if (error instanceof ApiError && error.code === 'duplicate_username') {
          setCreateUserNameError('这个登录名已经被占用了，请换一个。')
          return
        }
        throw error
      }
      await refreshAdminState()
      setUserForm({ username: '', displayName: '', password: '', subjectId: activeSubjects[0]?.id || '' })
      setCreateUserPasswordVisible(false)
      setCreateUserModalOpen(false)
      setUserListPage(1)
      setInfoMessage('新用户已创建。')
    })

  const handleResetUserPassword = (user: User) =>
    wrapAction(`reset-user-password:${user.id}`, async () => {
      if (userResetPassword.length < 6) {
        throw new Error('新密码至少 6 位')
      }
      await resetUserPassword(user.id, userResetPassword)
      setUserResetPassword('')
      setResetUserPasswordVisible(false)
      setResetPasswordModalOpen(false)
      setResetPasswordTarget(null)
      setInfoMessage('用户密码已重置。')
    })

  const handleDeleteUser = (user: User) =>
    wrapAction(`delete-user:${user.id}`, async () => {
      await deleteUser(user.id)
      await refreshAdminState()
      setDeleteConfirmModalOpen(false)
      setDeleteConfirmTarget(null)
      setInfoMessage('用户已删除。')
    })

  const handleAssignUserSubject = (user: User) =>
    wrapAction(`assign-user-subject:${user.id}`, async () => {
      const result: UserSubjectAssignmentResult = await assignUserSubject(user.id, subjectModalValue || null)
      await refreshAdminState()
      setSubjectModalOpen(false)
      setSubjectModalTarget(null)
      setSubjectModalValue('')
      setInfoMessage(result.forcedLogout ? '用户学科已更新，当前登录会话已强制退出。' : '用户学科已更新。')
    })

  const handleUploadImages = () =>
    wrapAction('upload-images', async () => {
      if (!selectedSubjectId || !selectedFiles.length) {
        throw new Error('请先选择学科和图片')
      }
      await uploadSubjectImages(selectedSubjectId, selectedFiles)
      await refreshAdminState()
      setSelectedFiles([])
      setInfoMessage('教材图片已上传到学科图片库。')
    })

  const handleGenerateDraft = () =>
    wrapAction('generate-draft', async () => {
      if (!selectedSubjectId || !selectedImageIds.length) {
        throw new Error('请先勾选要生成的教材图片')
      }
      const targetSubjectName = currentAdminSubjectName
      setDraftGenerationJob(null)
      const startedJob = await generateUnitDraft(selectedSubjectId, selectedImageIds)
      setDraftGenerationJob(startedJob)
      const finishedJob = await waitForGenerationJob(startedJob.id)
      await refreshAdminState()
      await refreshPublicData()
      if (finishedJob.draftUnitId) {
        setSelectedDraftId(finishedJob.draftUnitId)
      }
      setSelectedImageIds([])
      setAdminTab('drafts')
      setInfoMessage(`《${targetSubjectName || '当前学科'}》的单元草稿已生成，请校对后发布。`)
    })

  const handleRetryDraftGeneration = () =>
    wrapAction('retry-draft-generation', async () => {
      if (!draftGenerationJob?.id || !draftGenerationJob.hasOcrText) {
        throw new Error('当前失败任务还没有可复用的 OCR 结果。')
      }

      const startedJob = await retryGenerationDraft(draftGenerationJob.id)
      setDraftGenerationJob(startedJob)
      const finishedJob = await waitForGenerationJob(startedJob.id)
      await refreshAdminState()
      await refreshPublicData()
      if (finishedJob.draftUnitId) {
        setSelectedDraftId(finishedJob.draftUnitId)
      }
      setAdminTab('drafts')
      setInfoMessage('已基于上次 OCR 结果重试草稿整理。')
    })

  const handleSaveProjectSettings = (nextSettings: ProjectSettings) =>
    wrapAction('save-project-settings', async () => {
      const savedSettings = await saveProjectSettings(nextSettings)
      setProjectSettings(savedSettings)
      await refreshAdminState()
      await refreshPublicData()
      setInfoMessage(
        `已更新项目设置：${savedSettings.activeAiVendor === 'openai' ? 'OpenAI' : '阿里系'}，口语通过线 ${savedSettings.speakingPassScore} 分。`,
      )
    })

  const handleDraftSave = () =>
    wrapAction('save-draft', async () => {
      if (!selectedDraft) {
        throw new Error('没有可保存的草稿')
      }
      await updateDraftApi(selectedDraft.id, selectedDraft)
      await refreshAdminState()
      await refreshPublicData()
      setInfoMessage('草稿已保存。')
    })

  const handlePublishDraft = () =>
    wrapAction('publish-draft', async () => {
      if (!selectedDraft) {
        throw new Error('没有可发布的草稿')
      }
      await publishDraftApi(selectedDraft.id)
      await refreshAdminState()
      await refreshPublicData()
      setInfoMessage('草稿已发布到学生端。')
    })

  const handleSaveProvider = (provider: ProviderId) =>
    wrapAction(`save-provider-${provider}`, async () => {
      const form = providerForms[provider]
      await saveProviderSetting(provider, form)
      await refreshAdminState()
      setInfoMessage(`${provider} 配置已保存。`)
    })

  const updateProviderForm = (provider: ProviderId, patch: Partial<ProviderSetting>) => {
    setProviderForms((current) => ({
      ...current,
      [provider]:
        provider === 'openai'
          ? normalizeOpenAIProviderForm({
              ...current[provider],
              ...patch,
            })
          : provider === 'qwen'
            ? normalizeQwenProviderForm({
                ...current[provider],
                ...patch,
              })
            : normalizeAliyunOcrProviderForm({
                ...current[provider],
                ...patch,
              }),
    }))
  }

  const updatePricingOverride = (
    provider: ProviderId,
    capability: keyof ProviderPricing,
    field: 'inputPerMillion' | 'inputPerTenThousandChars' | 'outputPerMillion' | 'requestCost' | 'perMinute',
    value: string,
  ) => {
    const form = providerForms[provider]
    const nextValue = value === '' ? undefined : Number(value)
    updateProviderForm(provider, {
      pricing: {
        ...normalizePricing(form.pricing),
        [capability]: {
          ...normalizePricing(form.pricing)[capability],
          [field]: nextValue,
        },
      },
    })
  }

  const updateDraftField = (patch: Partial<Unit>) => {
    if (!selectedDraft) {
      return
    }
    setAdminState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => (draft.id === selectedDraft.id ? { ...draft, ...patch } : draft)),
      subjects: current.subjects.map((subject) => ({
        ...subject,
        units: subject.units.map((unit) => (unit.id === selectedDraft.id ? { ...unit, ...patch } : unit)),
      })),
    }))
  }

  const updateDraftReading = (patch: Partial<Unit['reading']>) => {
    if (!selectedDraft) {
      return
    }

    updateDraftField({
      reading: {
        ...selectedDraft.reading,
        ...patch,
      },
    })
  }

  const updateDraftActivity = (activityId: string, patch: Partial<Activity>) => {
    if (!selectedDraft) {
      return
    }

    updateDraftField({
      activities: selectedDraft.activities.map((activity) => (activity.id === activityId ? { ...activity, ...patch } : activity)) as Activity[],
    })
  }

  const serializeChoiceOptions = (options: ChoiceOption[] = []) =>
    options.map((option) => `${option.id} | ${option.label}${option.emoji ? ` | ${option.emoji}` : ''}`).join('\n')

  const parseChoiceOptions = (value: string): ChoiceOption[] =>
    value.split('\n').reduce<ChoiceOption[]>((options, line, index) => {
      const [id, label, emoji] = line.split('|').map((item) => item.trim())
      if (!label && !id) {
        return options
      }

      options.push({
        id: id || String.fromCharCode(97 + index),
        label: label || id || `选项 ${index + 1}`,
        emoji: emoji || undefined,
      })
      return options
    }, [])

  const getActivityAudioHint = (activity: Activity) => {
    if (activity.kind !== 'listen-choice' && activity.kind !== 'speak-repeat' && activity.kind !== 'write-spell') {
      return null
    }

    if (lessonAudioFeedback?.activityId === activity.id) {
      return lessonAudioFeedback
    }

    if (activity.audioUrl) {
      return {
        tone: 'info' as const,
        text: '已绑定预生成标准音频。',
      }
    }

    return {
      tone: 'warning' as const,
      text: '当前没有预生成音频，按钮会退回浏览器朗读。',
    }
  }

  const renderSecretField = ({
    fieldId,
    label,
    value,
    onChange,
  }: {
    fieldId: SecretFieldId
    label: string
    value: string
    onChange: (value: string) => void
  }) => (
    <label>
      {label}
      <div className="secret-input-row">
        <input
          type={secretVisibility[fieldId] ? 'text' : 'password'}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="icon-btn"
          type="button"
          aria-label={secretVisibility[fieldId] ? `隐藏${label}` : `显示${label}`}
          onClick={() => toggleSecretVisibility(fieldId)}
        >
          <EyeToggleIcon visible={secretVisibility[fieldId]} />
        </button>
      </div>
    </label>
  )

  const renderActivity = (activity: Activity) => {
    if (activity.kind === 'warmup') {
      return (
        <div className="activity-block">
          <div className="vocab-grid">
            {activity.cards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`vocab-card vocab-card-btn ${activeActivityLocked || warmupSeenCardIds.includes(card.id) ? 'seen' : ''}`}
                onClick={() => handleWarmupCardActivate(card.id, `${card.word}. ${card.example}`)}
                disabled={activeActivityLocked}
              >
                <img
                  className="vocab-illustration"
                  src={buildVocabularyIllustration(card)}
                  alt={card.imageLabel}
                  loading="lazy"
                />
                <div className="vocab-caption">{card.imageLabel}</div>
                <strong>{card.word}</strong>
                <span>{card.meaning}</span>
                <small>{card.example}</small>
                <em>{activeActivityLocked ? '已满星完成' : warmupSeenCardIds.includes(card.id) ? '已点读' : '点一下，听读音'}</em>
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (activity.kind === 'listen-choice') {
      const displayedChoiceAnswer = activeActivityLocked ? activity.correctOptionId : choiceAnswer
      const audioHint = getActivityAudioHint(activity)
      return (
        <div className="activity-block">
          <div className="audio-row">
            <button className="secondary-btn" onClick={() => void playLessonAudio(activity.id, activity.audioUrl, activity.audioText)}>
              {activity.audioUrl ? '播放标准音频' : '播放示范'}
            </button>
            <p>{activity.question}</p>
          </div>
          {audioHint ? <p className={`status-inline ${audioHint.tone === 'warning' ? 'error' : 'success'}`}>{audioHint.text}</p> : null}
          <div className="choice-grid">
            {activity.options.map((option) => (
              <button
                key={option.id}
                className={`choice-card ${displayedChoiceAnswer === option.id ? 'selected' : ''} ${
                  ((submission.status === 'done' || activeActivityLocked) && displayedChoiceAnswer === option.id && option.id === activity.correctOptionId)
                    ? 'correct'
                    : ''
                } ${wrongChoiceAnswer === option.id && submission.status !== 'done' && !activeActivityLocked ? 'wrong' : ''}`}
                onClick={() => void handleChoiceSelect(option.id)}
                disabled={submission.status === 'done' || activeActivityLocked}
              >
                <span>{option.emoji}</span>
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (activity.kind === 'speak-repeat') {
      const bestSpeakingEntry = getBestSpeakingHistoryEntry(speakingHistory)
      const audioHint = getActivityAudioHint(activity)
      const recordButtonLabel =
        speakingRecorderState === 'recording'
          ? '停止录音'
          : speakingRecorderState === 'uploading'
            ? '上传中...'
          : speakingRecorderState === 'recorded'
            ? '重新录音'
            : '开始录音'

      return (
        <div className="activity-block">
          <div className="speaking-panel">
            <p className="demo-line">{activity.transcript}</p>
            <p>{activity.hint}</p>
            {activeActivityLocked ? (
              <p className="status-inline success">本关已拿到 3 星，保留历史录音供回放查看。</p>
            ) : (
              <div className="speaking-inline-actions">
                <button className="secondary-btn" type="button" onClick={() => void playLessonAudio(activity.id, activity.audioUrl, activity.transcript)}>
                  {activity.audioUrl ? '听标准示范' : '听示范'}
                </button>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={speakingRecorderState === 'recording' ? handleStopSpeakingRecording : () => void handleStartSpeakingRecording()}
                  disabled={speakingRecorderState === 'uploading'}
                >
                  {recordButtonLabel}
                </button>
              </div>
            )}
            {audioHint ? <p className={`status-inline ${audioHint.tone === 'warning' ? 'error' : 'success'}`}>{audioHint.text}</p> : null}
            {speakingRecorderError ? <p className="status-inline error">{speakingRecorderError}</p> : null}
          </div>
          <div className="speaking-history-card">
            <div className="speaking-history-head">
              <strong>本课录音历史</strong>
            </div>
            {speakingHistory.length ? (
              <div className="speaking-history-list">
                {speakingHistory.map((entry) => (
                  <article
                    key={entry.id}
                    className={`speaking-history-item ${
                      (currentSpeakingHistoryId ? currentSpeakingHistoryId === entry.id : bestSpeakingEntry?.id === entry.id) ? 'active' : ''
                    }`}
                  >
                    <div>
                      <strong>{formatHistoryTime(entry.createdAt)}</strong>
                      <small>
                        {entry.submittedAt && entry.score !== null
                          ? `已评分 ${entry.score} 分${entry.passed ? ` · ${'⭐'.repeat(getScoreStars(entry.score, speakingPassScore))}` : ''}`
                          : '尚未评分'}
                      </small>
                    </div>
                    <audio
                      className="speaking-audio speaking-history-audio"
                      controls
                      src={entry.audioUrl}
                      onPlay={() => handleSelectSpeakingHistory(entry)}
                      onError={() => {
                        setSpeakingSubmitError('load failed')
                        setSpeakingSubmitErrorHistoryId(entry.id)
                      }}
                    />
                    {activeActivityLocked ? null : (
                      <div className="history-actions">
                        {entry.submittedAt ? null : (
                          <button
                            className="primary-btn"
                            type="button"
                            onClick={() => void handleSubmitSpeakingHistory(entry)}
                            disabled={speakingLoading}
                          >
                            {speakingHistorySubmittingId === entry.id ? '提交中...' : '提交评分'}
                          </button>
                        )}
                        <button className="secondary-btn" type="button" onClick={() => void handleDeleteSpeakingHistory(entry.id)}>
                          删除
                        </button>
                      </div>
                    )}
                    {entry.submittedAt && entry.score !== null ? (
                      <div className={`history-result-card ${entry.passed ? 'passed' : 'failed'}`}>
                        <strong>{entry.passed ? `已通过 ${entry.score} 分` : `已评分 ${entry.score} 分`}</strong>
                        {entry.passed
                          ? renderPersistentStars(
                              getScoreStars(entry.score, speakingPassScore),
                              getSpeakingHistoryAnchorId(entry.id),
                              `跟读历史 ${getScoreStars(entry.score, speakingPassScore)} 星`,
                              { maxStars: 3, dimRemaining: true },
                            )
                          : null}
                        <span>本次识别：{entry.transcript || '未识别到清楚文本'}</span>
                        <span>{entry.passed ? '本次通过，可以进入下一关。' : `本次未通过，需要达到 ${speakingPassScore} 分才能进入下一关。`}</span>
                        <small>{entry.feedback}</small>
                        {entry.passed ? (
                          <button className="primary-btn" type="button" onClick={goToNextActivity}>
                            {activeActivityIndex === activeUnit.activities.length - 1 ? '返回地图看徽章' : '下一关'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {((speakingSubmitError && speakingSubmitErrorHistoryId === entry.id) || entry.errorMessage) ? (
                      <p className="status-inline error">
                        {speakingSubmitErrorHistoryId === entry.id && speakingSubmitError ? speakingSubmitError : entry.errorMessage}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-copy">{activeActivityLocked ? '本关已满星完成，目前没有可显示的历史录音。' : '先录一段跟读，历史会显示在这里。'}</p>
            )}
          </div>
        </div>
      )
    }

    if (activity.kind === 'read-choice') {
      const displayedChoiceAnswer = activeActivityLocked ? activity.correctOptionId : choiceAnswer
      return (
        <div className="activity-block">
          <article className="reading-card">
            <h4>{activeUnit?.reading.title}</h4>
            <p>{activity.passage}</p>
          </article>
          <p>{activity.question}</p>
          <div className="choice-grid">
            {activity.options.map((option) => (
              <button
                key={option.id}
                className={`choice-card ${displayedChoiceAnswer === option.id ? 'selected' : ''} ${
                  ((submission.status === 'done' || activeActivityLocked) && displayedChoiceAnswer === option.id && option.id === activity.correctOptionId)
                    ? 'correct'
                    : ''
                } ${wrongChoiceAnswer === option.id && submission.status !== 'done' && !activeActivityLocked ? 'wrong' : ''}`}
                onClick={() => void handleChoiceSelect(option.id)}
                disabled={submission.status === 'done' || activeActivityLocked}
              >
                <span>{option.emoji}</span>
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (activity.kind === 'write-spell') {
      const audioHint = getActivityAudioHint(activity)
      return (
        <div className="activity-block">
          <article className="writing-card">
            <p className="sentence-line">{activity.sentence}</p>
            <div className="audio-row">
              <button className="secondary-btn" type="button" onClick={() => void playLessonAudio(activity.id, activity.audioUrl, activity.sentence)}>
                {activity.audioUrl ? '播放听写音频' : '朗读句子'}
              </button>
            </div>
            {audioHint ? <p className={`status-inline ${audioHint.tone === 'warning' ? 'error' : 'success'}`}>{audioHint.text}</p> : null}
            <input
              className="answer-input"
              value={activeActivityLocked ? activity.answer : textAnswer}
              onChange={(event) => setTextAnswer(event.target.value)}
              placeholder="在这里输入单词"
              disabled={activeActivityLocked}
            />
            {activeActivityLocked ? <span className="bubble-note">正确答案：{activity.answer}</span> : null}
            <div className="tip-list">{activity.tips.map((tip) => <span key={tip}>{tip}</span>)}</div>
          </article>
        </div>
      )
    }

  const challenge = activity as ChallengeActivity
  return (
    <div className="activity-block">
        <div className="challenge-list">
          {challenge.questions.map((question, index) => (
            <section key={question.id} className="challenge-card">
              <h4>{index + 1}. {question.prompt}</h4>
              <div className="challenge-options">
                {question.options.map((option) => (
                  <button
                    key={option.id}
                    className={`pill-option ${
                      (activeActivityReadOnly ? question.correctOptionId : challengeAnswers[question.id]) === option.id ? 'selected' : ''
                    } ${
                      (activeActivityReadOnly && option.id === question.correctOptionId) ||
                      (challengeCorrectIds[question.id] && challengeAnswers[question.id] === option.id)
                        ? 'correct'
                        : ''
                    } ${
                      challengeWrongAnswers[question.id] === option.id && !challengeCorrectIds[question.id] && !activeActivityReadOnly ? 'wrong' : ''
                    }`}
                    onClick={() => void handleChallengeSelect(question.id, option.id)}
                    disabled={activeActivityReadOnly || Boolean(challengeCorrectIds[question.id])}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    )
  }

  const primaryNavTabs =
    userSession.authenticated
      ? [
          ['home', '闯关地图'],
          ['learn', '学习站'],
          ['report', '家长报告'],
          ...(adminSession.authenticated ? ([['admin', '内容后台']] as const) : []),
        ]
      : adminSession.authenticated
        ? ([['admin', '内容后台']] as const)
        : []

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className={`topbar ${view === 'login' && !userSession.authenticated && !adminSession.authenticated ? 'topbar-login' : ''}`}>
        <div className="topbar-brand">
          <img
            className="topbar-logo"
            src="/haibao-header-photo.jpg?v=1"
            alt="海宝英语闯关岛站点图标"
            width="84"
            height="84"
          />
          <div className="topbar-copy">
            <h1>海宝英语闯关岛</h1>
            {userSession.authenticated ? <p className="subtitle">欢迎，{userSession.user?.username}</p> : null}
          </div>
        </div>
        {userSession.authenticated ? (
          <div className="topbar-actions">
            <div className="topbar-stats">
              <div className="stat-pill">
                <span className="topbar-stat-icon" aria-hidden="true">⭐</span>
                <strong>{progress.totalStars}</strong>
                <small>总星星</small>
              </div>
              <div className="stat-pill">
                <span>🔥</span>
                <strong>{progress.streakDays}</strong>
                <small>连续天数</small>
              </div>
              <div className="stat-pill">
                <span>🏅</span>
                <strong>{perfectUnitIds.length}</strong>
                <small>勋章</small>
              </div>
            </div>
            {userSession.authenticated ? (
              <button className="secondary-btn topbar-logout" disabled={busyMap['user-logout']} onClick={handleUserLogout}>
                {busyMap['user-logout'] ? '退出中...' : '退出学习账号'}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {view === 'login' || !primaryNavTabs.length ? null : (
        <nav className="nav-tabs" aria-label="主导航">
          {primaryNavTabs.map(([id, label]) => (
            <button key={id} className={`nav-tab ${view === id ? 'active' : ''}`} onClick={() => setView(id as ViewName)}>
              {label}
            </button>
          ))}
        </nav>
      )}

      {infoMessage ? <div className="status-banner success">{infoMessage}</div> : null}
      {errorMessage ? <div className="status-banner error">{errorMessage}</div> : null}

      {view === 'login' ? (
        <main className="login-screen">
          <section className="admin-panel login-panel">
            <div className="section-head">
              <h3>账号登录</h3>
            </div>
            {bootstrapped ? (
              <form
                className="admin-auth-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleEntryLogin()
                }}
              >
                <div className="editor-grid">
                  <label>
                    登录名
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      inputMode="email"
                      enterKeyHint="next"
                      lang="en"
                      spellCheck={false}
                      pattern="[A-Za-z0-9._-]*"
                      value={userLoginForm.username}
                      onChange={(event) => setUserLoginForm((current) => ({ ...current, username: event.target.value }))}
                    />
                  </label>
                  <label>
                    密码
                    <input
                      type="password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="current-password"
                      inputMode="text"
                      enterKeyHint="go"
                      lang="en"
                      spellCheck={false}
                      value={userLoginForm.password}
                      onChange={(event) => setUserLoginForm((current) => ({ ...current, password: event.target.value }))}
                    />
                  </label>
                </div>
                <button className="primary-btn" type="submit" disabled={busyMap['entry-login']}>
                  {busyMap['entry-login'] ? '登录中...' : '登录'}
                </button>
              </form>
            ) : (
              <form
                className="admin-auth-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleBootstrap()
                }}
              >
                <div className="editor-grid">
                  <label>
                    管理员账号
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      inputMode="email"
                      enterKeyHint="next"
                      lang="en"
                      spellCheck={false}
                      pattern="[A-Za-z0-9._-]*"
                      value={bootstrapForm.username}
                      onChange={(event) => setBootstrapForm((current) => ({ ...current, username: event.target.value }))}
                    />
                  </label>
                  <label>
                    管理员密码
                    <input
                      type="password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="new-password"
                      inputMode="text"
                      enterKeyHint="done"
                      lang="en"
                      spellCheck={false}
                      value={bootstrapForm.password}
                      onChange={(event) => setBootstrapForm((current) => ({ ...current, password: event.target.value }))}
                    />
                  </label>
                </div>
                <button className="primary-btn" type="submit" disabled={busyMap.bootstrap}>
                  {busyMap.bootstrap ? '初始化中...' : '创建管理员'}
                </button>
              </form>
            )}
          </section>
        </main>
      ) : null}

      {view === 'home' && userSession.authenticated ? (
        <main className="view-grid">
          <section className="hero-card">
            <div className="hero-copy">
              <span className="badge">今日推荐</span>
              <h2>{recommendation.title}</h2>
              <p>{recommendation.subtitle}</p>
              {todayStudySummary.started ? (
                <div className="today-study-summary">
                  <span>今天已完成 {todayStudySummary.completedParts} 个部分</span>
                  <span>
                    获得 {todayStudySummary.starsGained}
                    <span className="inline-star-icon" aria-hidden="true">⭐</span>
                  </span>
                  <span>学习了 {formatDurationLabel(todayStudySummary.durationSeconds)}</span>
                </div>
              ) : null}
              <button
                className="primary-btn"
                onClick={() => recommendation.unitId && openUnit(recommendation.unitId, recommendation.activityIndex)}
                disabled={!recommendation.unitId}
              >
                {recommendation.cta}
              </button>
            </div>
            <div className="hero-side">
              <div className="hero-panel">
                <span>当前学科</span>
                <strong>{currentSubject?.name || '等待发布'}</strong>
                <small>{currentSubject?.description || '后台发布学科后，这里会显示正式说明。'}</small>
              </div>
              <div className="hero-panel">
                <span>本周建议</span>
                <strong>{summarizeWeakPoints(progress)[0] || '保持听说读写全覆盖'}</strong>
                <small>{todayStudySummary.enough ? '今天已经学够了，接下来更适合轻松复习。' : '推荐先完成当前主线，再回顾薄弱点。'}</small>
              </div>
            </div>
          </section>

          <section className="map-card">
            <div className="section-head">
              <h3>学习地图</h3>
              <p>《海宝体验课》已作为正式学科展示，后续会继续扩展其他英语学科。</p>
            </div>
            <div className="unit-map">
              {publishedUnits.map((unit) => {
                const percent = getUnitProgressPercent(progress, unit)
                const unitStars = getUnitStarCount(progress.activityResults, unit, speakingPassScore)
                const maxUnitStars = unit.activities.length * 3
                const unitPerfect = perfectUnitIdSet.has(unit.id)
                return (
                  <article key={unit.id} className={`unit-card ${unit.id === activeUnitId ? 'active' : ''}`} style={{ ['--card-accent' as string]: unit.themeColor }}>
                    <div className="unit-card-head">
                      <div className="unit-badge">{unit.coverEmoji}</div>
                      {unitPerfect ? <span className="unit-medal">🏅 满星勋章</span> : null}
                    </div>
                    <div className="unit-meta">
                      <p>{unit.stage}</p>
                      <h4>{unit.title}</h4>
                      <span>{unit.goal}</span>
                    </div>
                    <div className="skill-row">{(['listen', 'speak', 'read', 'write'] as const).map((skill) => <span key={skill} className="skill-pill">{skillLabels[skill]}</span>)}</div>
                    <div className="unit-stars-row">
                      <span>本单元星星</span>
                      <strong>{unitStars} / {maxUnitStars}</strong>
                    </div>
                    {unitStars > 0 ? renderPersistentStars(unitStars, `unit-stars:${unit.id}`, `${unit.title} ${unitStars} 星`) : null}
                    <div className="progress-line"><div style={{ width: `${percent}%` }} /></div>
                    <div className="unit-footer">
                      <small>{getCompletedActivityCount(unit)}/{unit.activities.length} 已完成</small>
                      <button className="secondary-btn" onClick={() => openUnit(unit.id)}>{percent > 0 ? (unitPerfect ? '回顾' : '继续') : '开始'}</button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </main>
      ) : null}

      {view === 'learn' && userSession.authenticated && activeUnit && activeActivity ? (
        <main className="learn-layout">
          <aside className="lesson-sidebar">
            <div className="lesson-sidebar-card">
              <span className="badge">当前关卡</span>
              <h2>{activeUnit.title}</h2>
              <p>{activeUnit.goal}</p>
              <div className="lesson-progress"><div style={{ width: `${getUnitProgressPercent(progress, activeUnit)}%` }} /></div>
              <small>{getCompletedActivityCount(activeUnit)} / {activeUnit.activities.length} 已完成</small>
            </div>
            <div className="lesson-list">
              {activeUnit.activities.map((activity, index) => {
                const done = progress.activityResults[`${activeUnit.id}:${activity.id}`]?.completed
                const stars = getActivityStarCount(activeUnit.id, activity.id)
                return (
                  <button
                    key={activity.id}
                    className={`lesson-step ${index === activeActivityIndex ? 'active' : ''} ${done ? 'done' : ''}`}
                    onClick={() => {
                      setActiveActivityIndex(index)
                      resetTransientState()
                      scrollLessonStageIntoView('smooth')
                    }}
                  >
                    <span>{skillLabels[activity.skill]}</span>
                    <strong>{activity.title}</strong>
                    {stars > 0
                      ? renderPersistentStars(stars, `lesson-step:${activeUnit.id}:${activity.id}`, `${activity.title} ${stars} 星`, {
                          maxStars: 3,
                          dimRemaining: true,
                        })
                      : null}
                  </button>
                )
              })}
            </div>
          </aside>
          <section ref={lessonStageRef} className="lesson-stage">
            <div className="section-head">
              <div>
                <p className="eyebrow">STEP {activeActivityIndex + 1}</p>
                <h3>{activeActivity.title}</h3>
              </div>
              <span className="time-pill">{activeActivity.durationMinutes} 分钟</span>
            </div>
            <p className="lesson-prompt">{activeActivity.prompt}</p>
            {renderActivity(activeActivity)}
            <div className="action-row">
              {!activeActivityLocked && !['speak-repeat', 'listen-choice', 'read-choice', 'warmup', 'challenge'].includes(activeActivity.kind) ? (
                <button className="primary-btn" onClick={handleSubmitActivity} disabled={submission.status === 'done'}>
                  提交答案
                </button>
              ) : null}
              <button className="secondary-btn" onClick={() => setView('home')}>返回地图</button>
            </div>
            {displayedSubmission.status === 'done' ? (
              <div ref={resultCardRef} className={`result-card ${displayedSubmission.completed ? 'passed' : 'failed'}`}>
                <h4>{displayedSubmission.title}</h4>
                {activeUnit && activeActivity
                  ? renderPersistentStars(
                      displayedSubmission.stars,
                      getResultAnchorId(activeUnit.id, activeActivity.id),
                      `${activeActivity.title} ${displayedSubmission.stars} 星`,
                      { maxStars: 3, dimRemaining: true },
                    )
                  : null}
                <p>本关得分：{displayedSubmission.score}</p>
                <p>{displayedSubmission.mistakes.length ? `已加入复习：${displayedSubmission.mistakes.join(' / ')}` : '本关没有新增薄弱点，继续保持。'}</p>
                {displayedSubmission.completed ? (
                  <button className="primary-btn" onClick={goToNextActivity}>
                    {activeActivityIndex === activeUnit.activities.length - 1 ? '返回地图看徽章' : '下一关'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        </main>
      ) : null}

      {view === 'report' && userSession.authenticated ? (
        <main className="report-layout">
          <section className="report-card">
            <div className="section-head">
              <h3>家长一眼看懂</h3>
              <p>持续展示完成度、薄弱点和建议。</p>
            </div>
            <div className="report-grid">
              <article className="report-metric">
                <span>已完成单元</span>
                <strong>{progress.completedUnitIds.length}</strong>
                <small>共 {publishedUnits.length} 个已发布单元</small>
              </article>
              <article className="report-metric">
                <span>当前推荐</span>
                <strong>{recommendation.title}</strong>
                <small>{recommendation.subtitle}</small>
              </article>
              <article className="report-metric">
                <span>重点复习</span>
                <strong>{summarizeWeakPoints(progress)[0] || '暂无'}</strong>
                <small>薄弱点会自动进入复习挑战。</small>
              </article>
            </div>
          </section>
        </main>
      ) : null}

      {view === 'admin' ? (
        <main className="admin-layout">
          {!bootstrapped ? (
            <section className="admin-panel">
              <div className="section-head">
                <h3>初始化管理员</h3>
                <p>首次启动先创建后台管理员账号。</p>
              </div>
              <form
                className="admin-auth-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleBootstrap()
                }}
              >
                <div className="editor-grid">
                  <label>管理员账号<input autoCapitalize="none" autoCorrect="off" autoComplete="username" inputMode="email" enterKeyHint="next" lang="en" spellCheck={false} pattern="[A-Za-z0-9._-]*" value={bootstrapForm.username} onChange={(event) => setBootstrapForm((current) => ({ ...current, username: event.target.value }))} /></label>
                  <label>管理员密码<input type="password" autoCapitalize="none" autoCorrect="off" autoComplete="new-password" inputMode="text" enterKeyHint="done" lang="en" spellCheck={false} value={bootstrapForm.password} onChange={(event) => setBootstrapForm((current) => ({ ...current, password: event.target.value }))} /></label>
                </div>
                <button className="primary-btn" type="submit" disabled={busyMap.bootstrap}>{busyMap.bootstrap ? '初始化中...' : '创建管理员'}</button>
              </form>
            </section>
          ) : !adminSession.authenticated ? (
            <section className="admin-panel">
              <div className="section-head">
                <h3>管理员登录</h3>
                <p>学科管理、图片导入、模型设置和费用日志都需要登录后访问。</p>
              </div>
              <form
                className="admin-auth-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleLogin()
                }}
              >
                <div className="editor-grid">
                  <label>管理员账号<input autoCapitalize="none" autoCorrect="off" autoComplete="username" inputMode="email" enterKeyHint="next" lang="en" spellCheck={false} pattern="[A-Za-z0-9._-]*" value={loginForm.username} onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))} /></label>
                  <label>管理员密码<input type="password" autoCapitalize="none" autoCorrect="off" autoComplete="current-password" inputMode="text" enterKeyHint="go" lang="en" spellCheck={false} value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} /></label>
                </div>
                <button className="primary-btn" type="submit" disabled={busyMap.login}>{busyMap.login ? '登录中...' : '登录后台'}</button>
              </form>
            </section>
          ) : (
            <>
              <section className="admin-panel admin-sidebar">
                <div className="section-head">
                  <h3>后台导航</h3>
                </div>
                <div className="lesson-list">
                  {[
                    ['subjects', '学科管理'],
                    ['users', '客户管理'],
                    ['images', '图片库与生成'],
                    ['drafts', '草稿编辑'],
                    ['settings', '模型设置'],
                    ['security', '账号安全'],
                    ['logs', '费用日志'],
                  ].map(([id, label]) => (
                    <button key={id} className={`lesson-step ${adminTab === id ? 'active' : ''}`} onClick={() => setAdminTab(id as AdminTab)}>
                      <strong>{label}</strong>
                    </button>
                  ))}
                </div>
                <button className="secondary-btn" disabled={busyMap.logout} onClick={handleLogout}>{busyMap.logout ? '退出中...' : '退出后台'}</button>
              </section>

              <section className="admin-panel editor-panel">
                {adminTab === 'subjects' ? (
                  <>
                    <div className="section-head">
                      <h3>学科管理</h3>
                      <p>系统已预置正式学科《海宝体验课》，后续可继续新增英语学科。</p>
                    </div>
                    <div className="editor-grid">
                      <label>学科名称<input value={subjectForm.name} onChange={(event) => setSubjectForm((current) => ({ ...current, name: event.target.value }))} /></label>
                      <label>学科说明<textarea value={subjectForm.description} onChange={(event) => setSubjectForm((current) => ({ ...current, description: event.target.value }))} /></label>
                    </div>
                    <button className="primary-btn" disabled={busyMap['create-subject']} onClick={handleCreateSubject}>{busyMap['create-subject'] ? '创建中...' : '新建学科'}</button>
                    <div className="draft-list">
                      {adminState.subjects.map((subject) => (
                        <button key={subject.id} className={`draft-item ${selectedSubjectId === subject.id ? 'active' : ''}`} onClick={() => setSelectedSubjectId(subject.id)}>
                          <strong>{subject.name}</strong>
                          <span>{subject.description}</span>
                          <small>{subject.units.filter((unit) => unit.status === 'published').length} 个已发布单元 / {subject.images.length} 张图片</small>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {adminTab === 'users' ? (
                  <>
                    <div className="section-head">
                      <h3>客户管理</h3>
                      <p>直接查看当前用户列表，每条都可以重置密码或删除；新建用户在列表底部完成。</p>
                    </div>
                    <div className="editor-grid compact">
                      <label>
                        搜索登录名
                        <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="按登录名筛选" />
                      </label>
                    </div>
                    <div className="pagination-row">
                      <small className="pagination-info">
                        共 {filteredUsers.length} 位用户，第 {userListPage} / {userPageCount} 页
                      </small>
                      <div className="pagination-actions">
                        <button
                          className="secondary-btn"
                          disabled={userListPage <= 1}
                          onClick={() => setUserListPage((current) => Math.max(1, current - 1))}
                        >
                          上一页
                        </button>
                        <button
                          className="secondary-btn"
                          disabled={userListPage >= userPageCount}
                          onClick={() => setUserListPage((current) => Math.min(userPageCount, current + 1))}
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                    <div className="draft-list">
                      {paginatedUsers.map((user) => (
                        <article key={user.id} className="user-list-item">
                          <div className="user-list-meta">
                            <strong>{user.username}</strong>
                            <span>用户名：{user.displayName}</span>
                            <span>当前学科：{adminState.subjects.find((subject) => subject.id === user.subjectId)?.name || '未设置'}</span>
                            <small>创建时间：{new Date(user.createdAt).toLocaleString('zh-CN')}</small>
                          </div>
                          <div className="user-list-actions">
                            <button
                              className="secondary-btn"
                              disabled={busyMap[`assign-user-subject:${user.id}`]}
                              onClick={() => {
                                setSubjectModalTarget(user)
                                setSubjectModalValue(user.subjectId || '')
                                setSubjectModalOpen(true)
                              }}
                            >
                              {busyMap[`assign-user-subject:${user.id}`] ? '设置中...' : '设置学科'}
                            </button>
                            <button
                              className="primary-btn"
                              disabled={busyMap[`reset-user-password:${user.id}`]}
                              onClick={() => {
                                setResetPasswordTarget(user)
                                setUserResetPassword('')
                                setResetUserPasswordVisible(false)
                                setResetPasswordModalOpen(true)
                              }}
                            >
                              {busyMap[`reset-user-password:${user.id}`] ? '重置中...' : '重置密码'}
                            </button>
                            <button
                              className="secondary-btn"
                              disabled={busyMap[`delete-user:${user.id}`]}
                              onClick={() => {
                                setDeleteConfirmTarget(user)
                                setDeleteConfirmModalOpen(true)
                              }}
                            >
                              {busyMap[`delete-user:${user.id}`] ? '删除中...' : '删除'}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    {!paginatedUsers.length ? <p className="empty-copy">没有匹配的用户，请换个登录名关键词试试。</p> : null}
                    <div className="action-row">
                      <button
                        className="primary-btn"
                        onClick={() => {
                          setCreateUserNameError('')
                          setCreateUserPasswordVisible(false)
                          setUserForm({ username: '', displayName: '', password: '', subjectId: activeSubjects[0]?.id || '' })
                          setCreateUserModalOpen(true)
                        }}
                      >
                        新建用户
                      </button>
                    </div>
                  </>
                ) : null}

                {adminTab === 'images' ? (
                  <>
                    <div className="section-head">
                      <h3>图片库与单元生成</h3>
                      <p>在学科中持续上传教材页图片，勾选一批后手动生成一个单元草稿。OCR 与草稿模型会自动跟随当前激活供应商。</p>
                    </div>
                    <div className="settings-note">
                      <p>当前激活方案：<strong>{activeAiVendor === 'openai' ? 'OpenAI（文本 + 图像 OCR + 语音转写 + 语音合成）' : '阿里系（Qwen + DashScope 语音 + 阿里云 OCR）'}</strong></p>
                    </div>
                    <div className="editor-grid">
                      <label>
                        当前学科
                        <select value={selectedSubjectId} onChange={(event) => setSelectedSubjectId(event.target.value)}>
                          {adminState.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                        </select>
                      </label>
                      <label>
                        上传教材图片
                        <input type="file" multiple accept="image/*" onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))} />
                      </label>
                    </div>
                    <div className="action-row">
                      <button className="primary-btn" disabled={busyMap['upload-images']} onClick={handleUploadImages}>{busyMap['upload-images'] ? '上传中...' : '上传到图片库'}</button>
                      <button className="primary-btn" disabled={busyMap['generate-draft']} onClick={handleGenerateDraft}>{busyMap['generate-draft'] ? '生成中...' : '生成单元草稿'}</button>
                    </div>
                    {draftGenerationJob ? (
                      <div className={`generation-progress-card ${draftGenerationJob.status}`}>
                        <div className="generation-progress-head">
                          <strong>
                            {draftGenerationJob.status === 'failed'
                              ? '生成失败'
                              : draftGenerationJob.status === 'success'
                                ? '生成完成'
                                : '正在生成单元草稿'}
                          </strong>
                          <span>{getGenerationProgressPercent(draftGenerationJob)}%</span>
                        </div>
                        <small>当前学科：{draftGenerationSubjectName || '未选择学科'}</small>
                        <div className="generation-progress-track" aria-hidden="true">
                          <span style={{ width: `${getGenerationProgressPercent(draftGenerationJob)}%` }} />
                        </div>
                        <p>{getGenerationProgressHint(draftGenerationJob)}</p>
                        {draftGenerationJob.stage === 'ocr' ? (
                          <small>当前进度：已完成 {draftGenerationJob.processedImages} / {draftGenerationJob.totalImages} 张教材页识别。</small>
                        ) : null}
                        {draftGenerationJob.status === 'failed' && draftGenerationJob.errorMessage ? <small>{draftGenerationJob.errorMessage}</small> : null}
                        {draftGenerationJob.status === 'failed' && draftGenerationJob.hasOcrText ? (
                          <div className="action-row compact">
                            <button
                              className="primary-btn"
                              disabled={busyMap['retry-draft-generation']}
                              onClick={handleRetryDraftGeneration}
                            >
                              {busyMap['retry-draft-generation'] ? '重试中...' : '直接重试草稿'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="action-row compact">
                      <button className="secondary-btn" type="button" onClick={() => setSelectedImageIds(sortedAdminImages.map((image) => image.id))} disabled={!sortedAdminImages.length || allAdminImagesSelected}>
                        全选图片
                      </button>
                      <button className="secondary-btn" type="button" onClick={() => setSelectedImageIds([])} disabled={!selectedImageIds.length}>
                        清空队列
                      </button>
                    </div>
                    <div className="settings-note">
                      <p>图片库默认按文件名排序。勾选后会进入右侧生成队列；生成时严格按队列顺序送去 OCR 和草稿整理。当前已选 {selectedImageIds.length} / {sortedAdminImages.length} 张。</p>
                    </div>
                    <div className="image-grid">
                      {sortedAdminImages.map((image) => (
                        <label
                          key={image.id}
                          className={`image-card ${selectedImageIds.includes(image.id) ? 'selected' : ''}`}
                          onDoubleClick={() => openImagePreview(image.id)}
                        >
                          <input
                            type="checkbox"
                            checked={selectedImageIds.includes(image.id)}
                            onChange={() =>
                              setSelectedImageIds((current) =>
                                current.includes(image.id) ? current.filter((item) => item !== image.id) : [...current, image.id],
                              )
                            }
                          />
                          <img src={image.url} alt={image.fileName} />
                          <strong>{image.fileName}</strong>
                          <small>双击查看大图</small>
                          {selectedImageIds.includes(image.id) ? <small>队列第 {selectedImageIds.indexOf(image.id) + 1} 张</small> : null}
                        </label>
                      ))}
                    </div>
                    <div className="draft-list">
                      {selectedImageQueue.length ? (
                        selectedImageQueue.map((image, index) => (
                          <article
                            key={image.id}
                            className="draft-item"
                            draggable
                            onDragStart={() => setDraggedQueueImageId(image.id)}
                            onDragEnd={() => setDraggedQueueImageId('')}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => handleQueueDrop(image.id, 'before')}
                          >
                            <strong>{index + 1}. {image.fileName}</strong>
                            <span>拖拽调整顺序，生成时按这里的先后识别。</span>
                            <div className="action-row compact">
                              <button className="secondary-btn" type="button" onClick={() => moveSelectedImage(image.id, -1)} disabled={index === 0}>上移</button>
                              <button className="secondary-btn" type="button" onClick={() => moveSelectedImage(image.id, 1)} disabled={index === selectedImageQueue.length - 1}>下移</button>
                              <button className="secondary-btn" type="button" onClick={() => setSelectedImageIds((current) => current.filter((item) => item !== image.id))}>移出队列</button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="empty-copy">还没有加入生成队列。先从上方图片库勾选同一单元的教材页，再拖拽调整顺序。</p>
                      )}
                    </div>
                  </>
                ) : null}

                {adminTab === 'drafts' ? (
                  <>
                    <div className="section-head">
                      <h3>草稿编辑</h3>
                      <p>OCR + 模型生成后的内容先进入草稿态，人工校对后再发布。</p>
                    </div>
                    {selectedDraft ? (
                      <>
                        <div className="draft-list">
                          {adminState.drafts.map((draft) => (
                            <button key={draft.id} className={`draft-item ${selectedDraftId === draft.id ? 'active' : ''}`} onClick={() => setSelectedDraftId(draft.id)}>
                              <strong>{draft.title}</strong>
                              <span>{draft.stage}</span>
                              <small>
                                {(draft.contentOrigin === 'imported' ? '教材导入草稿' : '框架草稿') +
                                  ' · ' +
                                  (adminState.subjects.find((subject) => subject.id === draft.subjectId)?.name || '未知学科')}
                              </small>
                            </button>
                          ))}
                        </div>
                        <div className="editor-grid">
                          <label>单元标题<input value={selectedDraft.title} onChange={(event) => updateDraftField({ title: event.target.value })} /></label>
                          <label>阶段<input value={selectedDraft.stage} onChange={(event) => updateDraftField({ stage: event.target.value })} /></label>
                          <label>封面 Emoji<input value={selectedDraft.coverEmoji} onChange={(event) => updateDraftField({ coverEmoji: event.target.value })} /></label>
                          <label>主题色<input value={selectedDraft.themeColor} onChange={(event) => updateDraftField({ themeColor: event.target.value })} /></label>
                          <label>
                            难度
                            <select value={selectedDraft.difficulty} onChange={(event) => updateDraftField({ difficulty: event.target.value as Unit['difficulty'] })}>
                              <option value="Starter">Starter</option>
                              <option value="Bridge">Bridge</option>
                              <option value="Explorer">Explorer</option>
                            </select>
                          </label>
                          <label>学习目标<textarea value={selectedDraft.goal} onChange={(event) => updateDraftField({ goal: event.target.value })} /></label>
                          <label>词汇列表<textarea value={selectedDraft.vocabulary.map((item) => `${item.word} | ${item.meaning}`).join('\n')} onChange={(event) => updateDraftField({ vocabulary: event.target.value.split('\n').filter(Boolean).map((line, index) => {
                            const [word, meaning] = line.split('|').map((item) => item.trim())
                            return {
                              id: `${selectedDraft.id}-vocab-${index + 1}`,
                              word: word || '',
                              phonetic: '/demo/',
                              meaning: meaning || '待校对',
                              imageLabel: '待补充插图',
                              example: `This is ${word || 'demo'}.`,
                            }
                          }) })} /></label>
                          <label>句型列表<textarea value={selectedDraft.patterns.map((item) => item.sentence).join('\n')} onChange={(event) => updateDraftField({ patterns: event.target.value.split('\n').filter(Boolean).map((line, index) => ({
                            id: `${selectedDraft.id}-pattern-${index + 1}`,
                            sentence: line,
                            slots: ['demo'],
                            demoLine: line.replace('___', 'demo'),
                          })) })} /></label>
                          <label>阅读标题<input value={selectedDraft.reading.title} onChange={(event) => updateDraftReading({ title: event.target.value })} /></label>
                          <label>阅读音频文案<textarea value={selectedDraft.reading.audioText} onChange={(event) => updateDraftReading({ audioText: event.target.value })} /></label>
                          <label>阅读问题<input value={selectedDraft.reading.question} onChange={(event) => updateDraftReading({ question: event.target.value })} /></label>
                          <label>阅读内容<textarea value={selectedDraft.reading.content} onChange={(event) => updateDraftReading({ content: event.target.value })} /></label>
                        </div>
                        <div className="draft-list">
                          {selectedDraft.activities.map((activity) => (
                            <article key={activity.id} className="settings-card">
                              <strong>{activity.title}</strong>
                              <small>{activity.kind}</small>
                              <div className="editor-grid compact">
                                <label>标题<input value={activity.title} onChange={(event) => updateDraftActivity(activity.id, { title: event.target.value })} /></label>
                                <label>提示语<textarea value={activity.prompt} onChange={(event) => updateDraftActivity(activity.id, { prompt: event.target.value })} /></label>
                                {'durationMinutes' in activity ? (
                                  <label>时长（分钟）<input type="number" min="1" value={activity.durationMinutes} onChange={(event) => updateDraftActivity(activity.id, { durationMinutes: Math.max(1, Number(event.target.value) || 1) })} /></label>
                                ) : null}
                                {activity.kind === 'listen-choice' ? (
                                  <>
                                    <label>音频文案<textarea value={activity.audioText} onChange={(event) => updateDraftActivity(activity.id, { audioText: event.target.value })} /></label>
                                    <label>题目<input value={activity.question} onChange={(event) => updateDraftActivity(activity.id, { question: event.target.value })} /></label>
                                    <label>选项（每行：id | 文案 | emoji）<textarea value={serializeChoiceOptions(activity.options)} onChange={(event) => updateDraftActivity(activity.id, { options: parseChoiceOptions(event.target.value) })} /></label>
                                    <label>正确选项 ID<input value={activity.correctOptionId} onChange={(event) => updateDraftActivity(activity.id, { correctOptionId: event.target.value })} /></label>
                                  </>
                                ) : null}
                                {activity.kind === 'speak-repeat' ? (
                                  <>
                                    <label>跟读句子<textarea value={activity.transcript} onChange={(event) => updateDraftActivity(activity.id, { transcript: event.target.value })} /></label>
                                    <label>提示说明<textarea value={activity.hint} onChange={(event) => updateDraftActivity(activity.id, { hint: event.target.value })} /></label>
                                    <label>鼓励语（每行一条）<textarea value={activity.encouragement.join('\n')} onChange={(event) => updateDraftActivity(activity.id, { encouragement: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>
                                  </>
                                ) : null}
                                {activity.kind === 'read-choice' ? (
                                  <>
                                    <label>阅读正文<textarea value={activity.passage} onChange={(event) => updateDraftActivity(activity.id, { passage: event.target.value })} /></label>
                                    <label>题目<input value={activity.question} onChange={(event) => updateDraftActivity(activity.id, { question: event.target.value })} /></label>
                                    <label>选项（每行：id | 文案 | emoji）<textarea value={serializeChoiceOptions(activity.options)} onChange={(event) => updateDraftActivity(activity.id, { options: parseChoiceOptions(event.target.value) })} /></label>
                                    <label>正确选项 ID<input value={activity.correctOptionId} onChange={(event) => updateDraftActivity(activity.id, { correctOptionId: event.target.value })} /></label>
                                  </>
                                ) : null}
                                {activity.kind === 'write-spell' ? (
                                  <>
                                    <label>听写句子<textarea value={activity.sentence} onChange={(event) => updateDraftActivity(activity.id, { sentence: event.target.value })} /></label>
                                    <label>正确答案<input value={activity.answer} onChange={(event) => updateDraftActivity(activity.id, { answer: event.target.value })} /></label>
                                    <label>提示语（每行一条）<textarea value={activity.tips.join('\n')} onChange={(event) => updateDraftActivity(activity.id, { tips: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>
                                  </>
                                ) : null}
                                {activity.kind === 'challenge' ? (
                                  <label>挑战题 JSON<textarea value={JSON.stringify(activity.questions, null, 2)} onChange={(event) => {
                                    try {
                                      const questions = JSON.parse(event.target.value)
                                      updateDraftActivity(activity.id, { questions })
                                    } catch {
                                      // Ignore invalid JSON while editing.
                                    }
                                  }} /></label>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                        <div className="action-row">
                          <button className="primary-btn" disabled={busyMap['save-draft']} onClick={handleDraftSave}>{busyMap['save-draft'] ? '保存中...' : '保存草稿'}</button>
                          <button className="primary-btn" disabled={busyMap['publish-draft']} onClick={handlePublishDraft}>{busyMap['publish-draft'] ? '发布中...' : '发布单元'}</button>
                        </div>
                      </>
                    ) : (
                      <p className="empty-copy">还没有草稿，先在图片库里选择图片并生成草稿。</p>
                    )}
                  </>
                ) : null}

                {adminTab === 'settings' ? (
                  <>
                    <div className="section-head">
                      <h3>模型与 OCR 设置</h3>
                      <p>先选择全局 AI 供应商，再配置这一套方案对应的文本生成、OCR、语音转写和语音合成。</p>
                    </div>
                    <div className="settings-grid">
                      <article className="settings-card settings-card-wide">
                        <h4>全局 AI 方案</h4>
                        <div className="editor-grid compact">
                          <label>
                            当前启用供应商
                            <select
                              value={activeAiVendor}
                              onChange={(event) =>
                                void handleSaveProjectSettings({
                                  activeAiVendor: event.target.value as AiVendor,
                                  speakingPassScore,
                                })
                              }
                              disabled={busyMap['save-project-settings']}
                            >
                              <option value="openai">OpenAI</option>
                              <option value="aliyun">阿里系</option>
                            </select>
                          </label>
                          <label>
                            口语通过线
                            <select
                              value={speakingPassScore}
                              onChange={(event) =>
                                void handleSaveProjectSettings({
                                  activeAiVendor,
                                  speakingPassScore: Number(event.target.value) as SpeakingPassScore,
                                })
                              }
                              disabled={busyMap['save-project-settings']}
                            >
                              {speakingPassScoreOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option} 分
                                </option>
                              ))}
                            </select>
                            <small className="field-note">当前规则：100 分得 3 星，80 分以上得 2 星，通过线以上得 1 星。</small>
                          </label>
                        </div>
                        <div className="settings-note">
                          <p>这是项目级单选开关。切到 OpenAI 时，文本生成、图片 OCR、口语转写和教学音频合成都走 OpenAI；切到阿里系时，文本走 Qwen，口语转写与语音合成走 DashScope，OCR 走阿里云 OCR。</p>
                        </div>
                      </article>

                      {activeAiVendor === 'openai' && openAiForm ? (
                        <article className="settings-card settings-card-wide">
                          <h4>OpenAI</h4>
                          <div className="settings-note">
                            <p>已按 OpenAI Responses API 与音频转写文档收紧参数，只保留本项目实际需要且可校验的项。</p>
                            <ul className="settings-note-list">
                              <li><strong>文本模型</strong>：生成单元草稿。</li>
                              <li><strong>OCR 模型</strong>：用于教材图片文字提取。</li>
                              <li><strong>语音转写模型</strong>：用于口语跟读评分前的转写。</li>
                              <li><strong>TTS 模型</strong>：用于发布前预生成标准教学音频。</li>
                              <li><strong>Reasoning effort</strong>：控制推理深度，值越高通常越稳，但更慢更贵。</li>
                              <li><strong>Verbosity</strong>：控制回答展开程度，不影响 JSON 结构，只影响文字详略。</li>
                              <li><strong>Max output tokens</strong>：输出上限，官方定义里包含可见输出和 reasoning tokens。</li>
                            </ul>
                            <label className="checkbox-row">
                              <input type="checkbox" checked readOnly />
                              <span>固定启用结构化 JSON 输出，避免草稿生成出非 JSON 文本。</span>
                            </label>
                          </div>
                          <div className="editor-grid compact">
                            <label>
                              API 模式
                              <select value={openAiForm.apiMode} onChange={(event) => updateProviderForm('openai', { apiMode: event.target.value })}>
                                <option value="responses">Responses API</option>
                              </select>
                            </label>
                            <label>
                              文本模型
                              <select value={openAiForm.model} onChange={(event) => updateProviderForm('openai', { model: event.target.value, ocrModel: openAiForm.ocrModel || event.target.value })}>
                                {openAiModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{openAiModelOptions.find((option) => option.value === openAiForm.model)?.note}</small>
                            </label>
                            <label>
                              OCR 模型
                              <select value={openAiForm.ocrModel || openAiForm.model} onChange={(event) => updateProviderForm('openai', { ocrModel: event.target.value })}>
                                {openAiModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </label>
                            <label>
                              语音转写模型
                              <select value={openAiForm.speechModel || 'gpt-4o-mini-transcribe'} onChange={(event) => updateProviderForm('openai', { speechModel: event.target.value })}>
                                {openAiSpeechModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{openAiSpeechModelOptions.find((option) => option.value === openAiForm.speechModel)?.note}</small>
                            </label>
                            <label>
                              TTS 模型
                              <select value={openAiForm.ttsModel || 'gpt-4o-mini-tts'} onChange={(event) => updateProviderForm('openai', { ttsModel: event.target.value })}>
                                {openAiTtsModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{openAiTtsModelOptions.find((option) => option.value === openAiForm.ttsModel)?.note}</small>
                            </label>
                            <label>
                              TTS 音色
                              <select value={openAiForm.ttsVoice || 'alloy'} onChange={(event) => updateProviderForm('openai', { ttsVoice: event.target.value })}>
                                {openAiTtsVoiceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">使用 OpenAI 官方内置音色。</small>
                            </label>
                            <label>
                              TTS 格式
                              <select value={openAiForm.ttsFormat || 'mp3'} onChange={(event) => updateProviderForm('openai', { ttsFormat: event.target.value })}>
                                {openAiTtsFormatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{openAiTtsFormatOptions.find((option) => option.value === openAiForm.ttsFormat)?.note}</small>
                            </label>
                            <label>
                              TTS 提示词
                              <textarea
                                value={openAiForm.ttsInstructions || ''}
                                onChange={(event) => updateProviderForm('openai', { ttsInstructions: event.target.value })}
                                placeholder="Read in a warm, patient classroom voice for primary-school English learners."
                              />
                            </label>
                            {renderSecretField({
                              fieldId: 'openai-api-key',
                              label: 'API Key',
                              value: openAiForm.apiKey,
                              onChange: (value) => updateProviderForm('openai', { apiKey: value }),
                            })}
                            <label>
                              代理地址
                              <input
                                type="text"
                                inputMode="url"
                                value={openAiForm.proxyUrl || ''}
                                onChange={(event) => updateProviderForm('openai', { proxyUrl: event.target.value })}
                                placeholder={`留空直连；常用代理可填 ${defaultOpenAiProxyUrl}`}
                              />
                              <small className="field-note">仅 OpenAI 使用。默认直连；未写协议时会自动按 `http://` 处理。</small>
                            </label>
                            <label>
                              Reasoning effort
                              <select value={openAiForm.reasoningEffort} onChange={(event) => updateProviderForm('openai', { reasoningEffort: event.target.value })}>
                                {openAiReasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{openAiReasoningOptions.find((option) => option.value === openAiForm.reasoningEffort)?.note}</small>
                            </label>
                            <label>
                              Verbosity
                              <select value={openAiForm.verbosity || 'medium'} onChange={(event) => updateProviderForm('openai', { verbosity: event.target.value as ProviderSetting['verbosity'] })}>
                                {openAiVerbosityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{openAiVerbosityOptions.find((option) => option.value === openAiForm.verbosity)?.note}</small>
                            </label>
                            <label>
                              Max output tokens
                              <select value={String(openAiForm.maxOutputTokens)} onChange={(event) => updateProviderForm('openai', { maxOutputTokens: Number(event.target.value) })}>
                                {openAiMaxOutputTokenOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                              </select>
                              <small className="field-note">用于限制单次生成上限，防止输出过长或成本失控。</small>
                            </label>
                          </div>
                          <details className="advanced-settings">
                            <summary>高级价格覆盖</summary>
                            <div className="editor-grid compact">
                              <label>文本输入单价/百万 token<input type="number" step="0.0001" value={openAiForm.pricing.text?.inputPerMillion ?? ''} onChange={(event) => updatePricingOverride('openai', 'text', 'inputPerMillion', event.target.value)} placeholder="默认快照" /></label>
                              <label>文本输出单价/百万 token<input type="number" step="0.0001" value={openAiForm.pricing.text?.outputPerMillion ?? ''} onChange={(event) => updatePricingOverride('openai', 'text', 'outputPerMillion', event.target.value)} placeholder="默认快照" /></label>
                              <label>语音输入单价/百万 token<input type="number" step="0.0001" value={openAiForm.pricing.speech?.inputPerMillion ?? ''} onChange={(event) => updatePricingOverride('openai', 'speech', 'inputPerMillion', event.target.value)} placeholder="默认快照" /></label>
                              <label>TTS 单次生成费用<input type="number" step="0.0001" value={openAiForm.pricing.tts?.requestCost ?? ''} onChange={(event) => updatePricingOverride('openai', 'tts', 'requestCost', event.target.value)} placeholder="默认快照" /></label>
                              <label>OCR 输入单价/百万 token<input type="number" step="0.0001" value={openAiForm.pricing.ocr?.inputPerMillion ?? ''} onChange={(event) => updatePricingOverride('openai', 'ocr', 'inputPerMillion', event.target.value)} placeholder="默认快照" /></label>
                              <label>OCR 输出单价/百万 token<input type="number" step="0.0001" value={openAiForm.pricing.ocr?.outputPerMillion ?? ''} onChange={(event) => updatePricingOverride('openai', 'ocr', 'outputPerMillion', event.target.value)} placeholder="默认快照" /></label>
                            </div>
                          </details>
                          <button className="primary-btn" disabled={busyMap['save-provider-openai']} onClick={() => handleSaveProvider('openai')}>
                            {busyMap['save-provider-openai'] ? '保存中...' : '保存 OpenAI 配置'}
                          </button>
                        </article>
                      ) : null}

                      {activeAiVendor === 'aliyun' && qwenForm ? (
                        <article className="settings-card">
                          <h4>Qwen 文本与 DashScope 语音</h4>
                          <div className="settings-note">
                            <p>这里的 <strong>通义 API Key</strong> 用于 Qwen 文本生成、DashScope 语音转写和语音合成，不等于阿里云 OCR 的 AccessKey。</p>
                          </div>
                          <div className="editor-grid compact">
                            <label>
                              文本接口模式
                              <select value={qwenForm.apiMode} onChange={(event) => updateProviderForm('qwen', { apiMode: event.target.value })}>
                                {qwenApiModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{qwenApiModeOptions.find((option) => option.value === qwenForm.apiMode)?.note}</small>
                            </label>
                            <label>
                              文本模型
                              <select value={qwenForm.model} onChange={(event) => updateProviderForm('qwen', { model: event.target.value })}>
                                {qwenModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{qwenModelOptions.find((option) => option.value === qwenForm.model)?.note}</small>
                            </label>
                            {renderSecretField({
                              fieldId: 'qwen-api-key',
                              label: '通义 API Key',
                              value: qwenForm.apiKey,
                              onChange: (value) => updateProviderForm('qwen', { apiKey: value }),
                            })}
                            <label>兼容模式 Endpoint<input value={qwenForm.endpoint} onChange={(event) => updateProviderForm('qwen', { endpoint: event.target.value })} placeholder="留空则使用官方默认地址" /></label>
                            <label>
                              Temperature
                              <select value={String(qwenForm.temperature)} onChange={(event) => updateProviderForm('qwen', { temperature: Number(event.target.value) })}>
                                {qwenTemperatureOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{qwenTemperatureOptions.find((option) => option.value === qwenForm.temperature)?.note}</small>
                            </label>
                            <label>
                              Max tokens
                              <select value={String(qwenForm.maxOutputTokens)} onChange={(event) => updateProviderForm('qwen', { maxOutputTokens: Number(event.target.value) })}>
                                {qwenMaxTokenOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                              </select>
                            </label>
                            <label>
                              语音转写模型
                              <select value={qwenForm.speechModel || 'qwen3-asr-flash'} onChange={(event) => updateProviderForm('qwen', { speechModel: event.target.value })}>
                                {qwenSpeechModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{qwenSpeechModelOptions.find((option) => option.value === qwenForm.speechModel)?.note}</small>
                            </label>
                            <label>
                              TTS 模型
                              <select value={qwenForm.ttsModel || 'qwen3-tts-flash'} onChange={(event) => updateProviderForm('qwen', { ttsModel: event.target.value })}>
                                {qwenTtsModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{qwenTtsModelOptions.find((option) => option.value === qwenForm.ttsModel)?.note}</small>
                            </label>
                            <label>
                              TTS 音色
                              <select value={qwenForm.ttsVoice || 'Cherry'} onChange={(event) => updateProviderForm('qwen', { ttsVoice: event.target.value })}>
                                {qwenTtsVoiceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </label>
                            <label>语言类型<input value={qwenForm.ttsLanguageType || 'English'} onChange={(event) => updateProviderForm('qwen', { ttsLanguageType: event.target.value })} placeholder="English" /></label>
                            <label>
                              TTS 格式
                              <select value={qwenForm.ttsFormat || 'wav'} onChange={(event) => updateProviderForm('qwen', { ttsFormat: event.target.value })}>
                                {qwenTtsFormatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{qwenTtsFormatOptions.find((option) => option.value === qwenForm.ttsFormat)?.note}</small>
                            </label>
                            <label>
                              TTS 提示词
                              <textarea value={qwenForm.ttsInstructions || ''} onChange={(event) => updateProviderForm('qwen', { ttsInstructions: event.target.value })} placeholder="留空则使用供应商默认播报风格" />
                            </label>
                          </div>
                          <details className="advanced-settings">
                            <summary>高级价格覆盖</summary>
                            <div className="editor-grid compact">
                              <label>文本输入单价/百万 token<input type="number" step="0.0001" value={qwenForm.pricing.text?.inputPerMillion ?? ''} onChange={(event) => updatePricingOverride('qwen', 'text', 'inputPerMillion', event.target.value)} placeholder="默认快照" /></label>
                              <label>文本输出单价/百万 token<input type="number" step="0.0001" value={qwenForm.pricing.text?.outputPerMillion ?? ''} onChange={(event) => updatePricingOverride('qwen', 'text', 'outputPerMillion', event.target.value)} placeholder="默认快照" /></label>
                              <label>语音单价/分钟<input type="number" step="0.0001" value={qwenForm.pricing.speech?.perMinute ?? ''} onChange={(event) => updatePricingOverride('qwen', 'speech', 'perMinute', event.target.value)} placeholder="默认快照" /></label>
                              <label>TTS 输入单价/万字符<input type="number" step="0.0001" value={qwenForm.pricing.tts?.inputPerTenThousandChars ?? ''} onChange={(event) => updatePricingOverride('qwen', 'tts', 'inputPerTenThousandChars', event.target.value)} placeholder="默认快照" /></label>
                            </div>
                          </details>
                          <button className="primary-btn" disabled={busyMap['save-provider-qwen']} onClick={() => handleSaveProvider('qwen')}>
                            {busyMap['save-provider-qwen'] ? '保存中...' : '保存 Qwen 配置'}
                          </button>
                        </article>
                      ) : null}

                      {activeAiVendor === 'aliyun' && aliyunOcrForm ? (
                        <article className="settings-card">
                          <h4>阿里云 OCR</h4>
                          <div className="settings-note">
                            <p>这里的 <strong>AccessKey ID / AccessKey Secret</strong> 仅用于阿里云 OCR，和上面的通义 API Key 不是同一套凭证。</p>
                          </div>
                          <div className="editor-grid compact">
                            {renderSecretField({
                              fieldId: 'aliyun-access-key-id',
                              label: 'AccessKey ID',
                              value: aliyunOcrForm.accessKeyId || '',
                              onChange: (value) => updateProviderForm('aliyun-ocr', { accessKeyId: value }),
                            })}
                            {renderSecretField({
                              fieldId: 'aliyun-access-key-secret',
                              label: 'AccessKey Secret',
                              value: aliyunOcrForm.accessKeySecret || '',
                              onChange: (value) => updateProviderForm('aliyun-ocr', { accessKeySecret: value }),
                            })}
                            <label>OCR Endpoint<input value={aliyunOcrForm.endpoint} onChange={(event) => updateProviderForm('aliyun-ocr', { endpoint: event.target.value })} /></label>
                            <label>
                              Region
                              <select value={aliyunOcrForm.regionId || 'cn-hangzhou'} onChange={(event) => updateProviderForm('aliyun-ocr', { regionId: event.target.value })}>
                                {aliyunRegionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </label>
                            <label>
                              OCR 类型
                              <select value={aliyunOcrForm.ocrType || 'Advanced'} onChange={(event) => updateProviderForm('aliyun-ocr', { ocrType: event.target.value })}>
                                {aliyunOcrTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                              <small className="field-note">{aliyunOcrTypeOptions.find((option) => option.value === aliyunOcrForm.ocrType)?.note}</small>
                            </label>
                          </div>
                          <details className="advanced-settings">
                            <summary>高级价格覆盖</summary>
                            <div className="editor-grid compact">
                              <label>单次 OCR 费用<input type="number" step="0.0001" value={aliyunOcrForm.pricing.ocr?.requestCost ?? ''} onChange={(event) => updatePricingOverride('aliyun-ocr', 'ocr', 'requestCost', event.target.value)} placeholder="默认快照" /></label>
                            </div>
                          </details>
                          <button className="primary-btn" disabled={busyMap['save-provider-aliyun-ocr']} onClick={() => handleSaveProvider('aliyun-ocr')}>
                            {busyMap['save-provider-aliyun-ocr'] ? '保存中...' : '保存 OCR 配置'}
                          </button>
                        </article>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {adminTab === 'security' ? (
                  <>
                    <div className="section-head">
                      <h3>账号安全</h3>
                      <p>这里只处理管理员密码修改，不再和模型设置混放。</p>
                    </div>
                    <article className="settings-card settings-card-wide">
                      <h4>修改管理员密码</h4>
                      <form
                        className="editor-grid compact"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void handleChangePassword()
                        }}
                      >
                        <label>当前密码<input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} /></label>
                        <label>新密码<input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} /></label>
                        <label>确认新密码<input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
                        <button className="primary-btn" type="submit" disabled={busyMap['change-password']}>
                          {busyMap['change-password'] ? '修改中...' : '修改密码'}
                        </button>
                      </form>
                    </article>
                  </>
                ) : null}

                {adminTab === 'logs' ? (
                  <>
                    <div className="section-head">
                      <h3>调用与费用日志</h3>
                      <p>记录什么时间、哪个功能、使用哪个供应商、消耗多少 token，以及系统估算费用。</p>
                    </div>
                    <div className="log-table">
                      <div className="log-row header">
                        <span>时间</span>
                        <span>功能</span>
                        <span>供应商</span>
                        <span>模型</span>
                        <span>Token</span>
                        <span>估算费用</span>
                      </div>
                      {adminState.usageLogs.map((log) => (
                        <div key={log.id} className="log-row">
                          <span>{new Date(log.timestamp).toLocaleString()}</span>
                          <span>{log.feature}</span>
                          <span>{log.provider}</span>
                          <span>{log.model}</span>
                          <span>{log.totalTokens || '-'}</span>
                          <span>{log.estimatedCost != null ? `${log.estimatedCost} ${log.currency}` : '待定价'}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            </>
          )}
        </main>
      ) : null}

      {previewImage ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPreviewImageId('')}>
          <div className="image-preview-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="image-preview-head">
              <strong>{previewImage.fileName}</strong>
              <small>
                {previewImageIndex + 1} / {sortedAdminImages.length} · {currentAdminSubjectName}
              </small>
            </div>
            <img className="image-preview-photo" src={previewImage.url} alt={previewImage.fileName} />
            <div className="action-row compact">
              <button className="secondary-btn" type="button" disabled={previewImageIndex <= 0} onClick={() => movePreviewImage(-1)}>
                上一张
              </button>
              <button
                className="secondary-btn"
                type="button"
                disabled={previewImageIndex >= sortedAdminImages.length - 1}
                onClick={() => movePreviewImage(1)}
              >
                下一张
              </button>
              <button className="primary-btn" type="button" onClick={() => setPreviewImageId('')}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createUserModalOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setCreateUserModalOpen(false)
            setCreateUserPasswordVisible(false)
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <h3 id="create-user-dialog-title">新建用户</h3>
              <p>填写登录名、用户名、初始密码和学科。</p>
            </div>
            <form
              className="editor-grid"
              onSubmit={(event) => {
                event.preventDefault()
                void handleCreateUser()
              }}
            >
              <label>
                登录名
                <input
                  aria-invalid={Boolean(createUserNameError)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  inputMode="email"
                  enterKeyHint="next"
                  lang="en"
                  spellCheck={false}
                  pattern="[A-Za-z0-9._-]*"
                  value={userForm.username}
                  onChange={(event) => {
                    setCreateUserNameError('')
                    setUserForm((current) => ({ ...current, username: event.target.value }))
                  }}
                />
                {createUserNameError ? <small className="field-error">{createUserNameError}</small> : null}
              </label>
              <label>
                用户姓名
                <input value={userForm.displayName} onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))} />
              </label>
              <label>
                当前学科
                <select value={userForm.subjectId} onChange={(event) => setUserForm((current) => ({ ...current, subjectId: event.target.value }))}>
                  <option value="" disabled>请选择学科</option>
                  {activeSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>
              </label>
              <label>
                初始密码
                <div className="secret-input-row">
                  <input
                    type={createUserPasswordVisible ? 'text' : 'password'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="new-password"
                    inputMode="text"
                    enterKeyHint="done"
                    lang="en"
                    spellCheck={false}
                    value={userForm.password}
                    onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                  />
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label={createUserPasswordVisible ? '隐藏初始密码' : '显示初始密码'}
                    onClick={() => setCreateUserPasswordVisible((current) => !current)}
                  >
                    <EyeToggleIcon visible={createUserPasswordVisible} />
                  </button>
                </div>
              </label>
              <div className="action-row">
                <button className="primary-btn" type="submit" disabled={busyMap['create-user']}>
                  {busyMap['create-user'] ? '创建中...' : '新建用户'}
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => {
                    setCreateUserModalOpen(false)
                    setCreateUserPasswordVisible(false)
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resetPasswordModalOpen && resetPasswordTarget ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setResetPasswordModalOpen(false)
            setResetPasswordTarget(null)
            setResetUserPasswordVisible(false)
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <h3 id="reset-password-dialog-title">重置密码</h3>
              <p>为 {resetPasswordTarget.username} 设置一个至少 6 位的新密码。</p>
            </div>
            <form
              className="editor-grid compact"
              onSubmit={(event) => {
                event.preventDefault()
                void handleResetUserPassword(resetPasswordTarget)
              }}
            >
              <label>
                新密码
                <div className="secret-input-row">
                  <input
                    type={resetUserPasswordVisible ? 'text' : 'password'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="new-password"
                    inputMode="text"
                    enterKeyHint="done"
                    lang="en"
                    spellCheck={false}
                    value={userResetPassword}
                    onChange={(event) => setUserResetPassword(event.target.value)}
                    placeholder="至少 6 位"
                  />
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label={resetUserPasswordVisible ? '隐藏新密码' : '显示新密码'}
                    onClick={() => setResetUserPasswordVisible((current) => !current)}
                  >
                    <EyeToggleIcon visible={resetUserPasswordVisible} />
                  </button>
                </div>
              </label>
              <div className="action-row">
                <button className="primary-btn" type="submit" disabled={busyMap[`reset-user-password:${resetPasswordTarget.id}`]}>
                  {busyMap[`reset-user-password:${resetPasswordTarget.id}`] ? '重置中...' : '确认重置'}
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => {
                    setResetPasswordModalOpen(false)
                    setResetPasswordTarget(null)
                    setResetUserPasswordVisible(false)
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {subjectModalOpen && subjectModalTarget ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setSubjectModalOpen(false)
            setSubjectModalTarget(null)
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="subject-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <h3 id="subject-dialog-title">设置学科</h3>
              <p>为 {subjectModalTarget.username} 选择当前生效的学科。</p>
            </div>
            <form
              className="editor-grid compact"
              onSubmit={(event) => {
                event.preventDefault()
                void handleAssignUserSubject(subjectModalTarget)
              }}
            >
              <label>
                当前学科
                <select value={subjectModalValue} onChange={(event) => setSubjectModalValue(event.target.value)}>
                  <option value="">未设置</option>
                  {activeSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>
              </label>
              <div className="action-row">
                <button className="primary-btn" type="submit" disabled={busyMap[`assign-user-subject:${subjectModalTarget.id}`]}>
                  {busyMap[`assign-user-subject:${subjectModalTarget.id}`] ? '保存中...' : '保存学科'}
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => {
                    setSubjectModalOpen(false)
                    setSubjectModalTarget(null)
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteConfirmModalOpen && deleteConfirmTarget ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setDeleteConfirmModalOpen(false)
            setDeleteConfirmTarget(null)
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <h3 id="delete-user-dialog-title">确认删除用户</h3>
              <p>删除后，这个学习账号将无法继续登录。当前要删除的是 {deleteConfirmTarget.username}。</p>
            </div>
            <div className="action-row">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  setDeleteConfirmModalOpen(false)
                  setDeleteConfirmTarget(null)
                }}
              >
                取消
              </button>
              <button
                className="primary-btn"
                type="button"
                disabled={busyMap[`delete-user:${deleteConfirmTarget.id}`]}
                onClick={() => void handleDeleteUser(deleteConfirmTarget)}
              >
                {busyMap[`delete-user:${deleteConfirmTarget.id}`] ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
