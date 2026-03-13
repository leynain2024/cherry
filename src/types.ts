export type SkillTag = 'listen' | 'speak' | 'read' | 'write'

export type ActivityKind =
  | 'warmup'
  | 'listen-choice'
  | 'speak-repeat'
  | 'read-choice'
  | 'write-spell'
  | 'challenge'

export type UnitStatus = 'published' | 'draft'
export type ContentOrigin = 'framework' | 'imported'

export interface VocabularyItem {
  id: string
  word: string
  phonetic: string
  meaning: string
  imageLabel: string
  example: string
}

export interface PatternItem {
  id: string
  sentence: string
  slots: string[]
  demoLine: string
}

export interface ReadingItem {
  id: string
  title: string
  content: string
  audioText: string
  question: string
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

export interface WarmupActivity {
  id: string
  title: string
  prompt: string
  skill: SkillTag
  kind: 'warmup'
  durationMinutes: number
  cards: VocabularyItem[]
}

export interface ListenChoiceActivity {
  id: string
  title: string
  prompt: string
  skill: SkillTag
  kind: 'listen-choice'
  durationMinutes: number
  audioText: string
  question: string
  options: ChoiceOption[]
  correctOptionId: string
}

export interface SpeakRepeatActivity {
  id: string
  title: string
  prompt: string
  skill: SkillTag
  kind: 'speak-repeat'
  durationMinutes: number
  transcript: string
  hint: string
  encouragement: string[]
}

export interface ReadChoiceActivity {
  id: string
  title: string
  prompt: string
  skill: SkillTag
  kind: 'read-choice'
  durationMinutes: number
  passage: string
  question: string
  options: ChoiceOption[]
  correctOptionId: string
}

export interface WriteSpellActivity {
  id: string
  title: string
  prompt: string
  skill: SkillTag
  kind: 'write-spell'
  durationMinutes: number
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

export interface ChallengeActivity {
  id: string
  title: string
  prompt: string
  skill: SkillTag
  kind: 'challenge'
  durationMinutes: number
  reviewIds: string[]
  questions: ChallengeQuestion[]
}

export type Activity =
  | WarmupActivity
  | ListenChoiceActivity
  | SpeakRepeatActivity
  | ReadChoiceActivity
  | WriteSpellActivity
  | ChallengeActivity

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
  vocabulary: VocabularyItem[]
  patterns: PatternItem[]
  reading: ReadingItem
  activities: Activity[]
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
  pageLabel?: string
  url?: string
}

export interface ActivityResult {
  unitId: string
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
  outputPerMillion?: number
  requestCost?: number
  perMinute?: number
}

export interface ProviderPricing {
  text?: PricingValues
  speech?: PricingValues
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
