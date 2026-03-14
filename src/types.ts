export type SkillTag = 'listen' | 'speak' | 'read' | 'write'

export type ActivityKind =
  | 'warmup'
  | 'vocab-cn-write-en'
  | 'vocab-en-choose-zh'
  | 'vocab-audio-write-en'
  | 'vocab-audio-choose-zh'
  | 'listen-choice'
  | 'speak-repeat'
  | 'read-choice'
  | 'write-spell'
  | 'challenge'

export type UnitStatus = 'published' | 'draft'
export type ContentOrigin = 'framework' | 'imported'
export type InventoryContentType =
  | 'vocabulary'
  | 'dialogue'
  | 'listening'
  | 'speaking'
  | 'reading'
  | 'writing'
  | 'pronunciation'
  | 'pattern'
  | 'assessment'

export interface AudioAssetRef {
  audioAssetId?: string
  audioText?: string
  audioUrl?: string
  audioMimeType?: string
}

export interface VocabularyItem extends AudioAssetRef {
  id: string
  word: string
  phonetic: string
  meaning: string
  imageLabel: string
  example: string
  sourcePageIds: string[]
  sourceLessonLabel?: string
  relatedPatternIds?: string[]
  introducedInLessonId?: string
  isCore: boolean
}

export interface PatternItem {
  id: string
  sentence: string
  slots: string[]
  demoLine: string
  sourcePageIds?: string[]
  sourceLessonLabel?: string
}

export interface RewardRule {
  starsPerComplete: number
  starsPerPerfect: number
  unlockAtStars: number
  reviewTriggerMistakes: number
}

export interface ChoiceOption {
  id: string
  label: string
  detail?: string
  emoji?: string
}

export interface BaseActivity {
  id: string
  title: string
  prompt: string
  skill: SkillTag
  kind: ActivityKind
  durationMinutes: number
  lessonId?: string
  lessonTitle?: string
  sourceInventoryIds?: string[]
  sourcePageIds?: string[]
  gameLabel?: string
}

export interface WarmupActivity extends BaseActivity {
  kind: 'warmup'
  cards: VocabularyItem[]
}

export interface VocabCnWriteEnActivity extends BaseActivity {
  kind: 'vocab-cn-write-en'
  vocabularyId: string
  word: string
  meaning: string
  answer: string
  tips: string[]
}

export interface VocabEnChooseZhActivity extends BaseActivity {
  kind: 'vocab-en-choose-zh'
  vocabularyId: string
  word: string
  question: string
  options: ChoiceOption[]
  correctOptionId: string
}

export interface VocabAudioWriteEnActivity extends BaseActivity, AudioAssetRef {
  kind: 'vocab-audio-write-en'
  vocabularyId: string
  word: string
  meaning: string
  answer: string
  tips: string[]
}

export interface VocabAudioChooseZhActivity extends BaseActivity, AudioAssetRef {
  kind: 'vocab-audio-choose-zh'
  vocabularyId: string
  word: string
  question: string
  options: ChoiceOption[]
  correctOptionId: string
}

export interface ListenChoiceActivity extends BaseActivity, AudioAssetRef {
  kind: 'listen-choice'
  question: string
  options: ChoiceOption[]
  correctOptionId: string
}

export interface SpeakRepeatActivity extends BaseActivity, AudioAssetRef {
  kind: 'speak-repeat'
  transcript: string
  hint: string
  encouragement: string[]
}

export interface ReadChoiceActivity extends BaseActivity {
  kind: 'read-choice'
  passage: string
  audioText?: string
  question: string
  options: ChoiceOption[]
  correctOptionId: string
}

export interface WriteSpellActivity extends BaseActivity, AudioAssetRef {
  kind: 'write-spell'
  sentence: string
  answer: string
  tips: string[]
}

export interface ChallengeQuestion {
  id: string
  prompt: string
  options: ChoiceOption[]
  correctOptionId: string
}

export interface ChallengeActivity extends BaseActivity {
  kind: 'challenge'
  reviewIds: string[]
  questions: ChallengeQuestion[]
}

export type Activity =
  | WarmupActivity
  | VocabCnWriteEnActivity
  | VocabEnChooseZhActivity
  | VocabAudioWriteEnActivity
  | VocabAudioChooseZhActivity
  | ListenChoiceActivity
  | SpeakRepeatActivity
  | ReadChoiceActivity
  | WriteSpellActivity
  | ChallengeActivity

export interface LessonSection {
  id: string
  skill: SkillTag
  title: string
  activityIds: string[]
  estimatedMinutes: number
}

export interface Lesson {
  id: string
  title: string
  order: number
  estimatedMinutes: number
  sourcePageIds: string[]
  sourceLessonLabel: string
  vocabularyRefs: string[]
  sections: LessonSection[]
  activities: Activity[]
  lessonQuiz?: ChallengeActivity | null
}

export interface ContentInventoryItem {
  id: string
  sequence: number
  sourcePageIds: string[]
  sourceLessonLabel: string
  sourceSectionLabel: string
  contentType: InventoryContentType
  title: string
  skill: SkillTag
  estimatedMinutes: number
  vocabularyIds: string[]
  content: Record<string, unknown>
}

export interface UnitAssessment {
  id: string
  title: string
  prompt: string
  durationMinutes: number
  reviewIds: string[]
  questions: ChallengeQuestion[]
}

export interface Unit {
  id: string
  sourceUnitId?: string
  subjectId: string
  title: string
  source: string
  stage: string
  goal: string
  difficulty: 'Starter' | 'Bridge' | 'Explorer'
  unlockOrder: number
  coverEmoji: string
  themeColor: string
  status: UnitStatus
  contentOrigin: ContentOrigin
  sourceImageIds: string[]
  rewardRule: RewardRule
  vocabularyBank: VocabularyItem[]
  patterns: PatternItem[]
  contentInventory: ContentInventoryItem[]
  lessons: Lesson[]
  unitReview?: UnitAssessment | null
  unitTest?: UnitAssessment | null
  vocabulary?: VocabularyItem[]
  reading?: {
    id: string
    title: string
    content: string
    audioText: string
    question: string
  }
  activities?: Activity[]
  createdAt?: string
  updatedAt?: string
}

export interface Subject {
  id: string
  name: string
  description: string
  themeColor: string
  status: string
  createdAt: string
}

export interface SubjectImage {
  id: string
  subjectId: string
  fileName: string
  filePath: string
  uploadedAt: string
  sortOrder?: number
  pageLabel?: string
  url?: string
}

export interface ActivityResult {
  unitId: string
  lessonId: string
  activityId: string
  completed: boolean
  score: number
  durationSeconds: number
  mistakes: string[]
  completedAt: string
}

export interface WeakPoint {
  id: string
  label: string
  type: 'vocabulary' | 'pattern' | 'spelling'
  misses: number
}

export interface StudentProgress {
  childName: string
  currentUnitId: string
  totalStars: number
  streakDays: number
  lastActiveDate: string
  completedUnitIds: string[]
  activityResults: Record<string, ActivityResult>
  weakPoints: WeakPoint[]
  dailyStats?: Record<string, DailyStat>
}

export interface DailyStat {
  date: string
  durationSeconds: number
  starsGained: number
  badgesGained: number
}

export interface User {
  id: string
  username: string
  displayName: string
  subjectId: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
}

export interface UserSession {
  authenticated: boolean
  user: User | null
}

export interface SpeakingRecording {
  id: string
  unitId: string
  activityId: string
  createdAt: string
  mimeType: string
  durationSeconds: number
  audioUrl: string
  transcript: string
  normalizedTranscript: string
  normalizedTarget: string
  score: number | null
  passed: boolean
  feedback: string
  mistakes: string[]
  submittedAt: string | null
  errorMessage: string
}

export interface AppData {
  bootstrapped?: boolean
  subjects?: Subject[]
  units: Unit[]
  drafts: Unit[]
  progress: StudentProgress
  projectSettings?: ProjectSettings
  currentUser?: User | null
}

export interface Recommendation {
  title: string
  subtitle: string
  unitId: string
  activityIndex: number
  cta: string
}

export interface TodayStudySummary {
  date: string
  durationSeconds: number
  starsGained: number
  badgesGained: number
  completedParts: number
  started: boolean
  enough: boolean
}

export type AiVendor = 'openai' | 'aliyun'
export type ProviderId = 'openai' | 'qwen' | 'aliyun-ocr'
export type SpeakingPassScore = 60 | 65 | 70 | 75

export interface PricingValues {
  inputPerMillion?: number
  inputPerTenThousandChars?: number
  outputPerMillion?: number
  requestCost?: number
  perMinute?: number
}

export interface ProviderPricing {
  text?: PricingValues
  speech?: PricingValues
  tts?: PricingValues
  ocr?: PricingValues
}

export interface ProviderSetting {
  provider: ProviderId
  apiMode: string
  model: string
  apiKey: string
  baseUrl: string
  endpoint: string
  proxyUrl?: string
  reasoningEffort: string
  verbosity?: 'low' | 'medium' | 'high'
  temperature: number
  maxOutputTokens: number
  speechModel?: string
  ttsModel?: string
  ttsVoice?: string
  ttsFormat?: string
  ttsInstructions?: string
  ttsLanguageType?: string
  ocrModel?: string
  accessKeyId?: string
  accessKeySecret?: string
  regionId?: string
  ocrType?: string
  pricing: ProviderPricing
  updatedAt?: string
}

export interface ProjectSettings {
  activeAiVendor: AiVendor
  speakingPassScore: SpeakingPassScore
  dailyLessonMinMinutes: number
  dailyLessonMaxMinutes: number
}

export interface UsageLog {
  id: number
  timestamp: string
  subjectId?: string
  feature: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number | null
  currency: string
  status: string
  jobId?: string
  details: Record<string, unknown>
}

export type GenerationJobStatus = 'running' | 'success' | 'failed'
export type GenerationJobStage = 'queued' | 'ocr' | 'draft' | 'completed' | 'failed'

export interface GenerationJob {
  id: string
  subjectId: string
  imageIds: string[]
  provider: string
  model: string
  status: GenerationJobStatus
  stage: GenerationJobStage
  processedImages: number
  totalImages: number
  message: string
  hasOcrText: boolean
  hasDraftResponse: boolean
  hasParsedPayload: boolean
  draftUnitId?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface SpeakingEvaluationResult {
  transcript: string
  normalizedTranscript: string
  normalizedTarget: string
  score: number
  passed: boolean
  feedback: string
  mistakes: string[]
}

export interface AdminState {
  subjects: Array<Subject & { images: SubjectImage[]; units: Unit[] }>
  drafts: Unit[]
  generationJobs: GenerationJob[]
  projectSettings: ProjectSettings
  providerSettings: ProviderSetting[]
  usageLogs: UsageLog[]
  users: User[]
}

export interface UserSubjectAssignmentResult {
  user: User
  forcedLogout: boolean
}

export interface AdminSession {
  bootstrapped: boolean
  authenticated: boolean
  username: string | null
}
