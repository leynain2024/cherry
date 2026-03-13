import type {
  AdminSession,
  AdminState,
  AppData,
  ProjectSettings,
  ProviderId,
  ProviderSetting,
  SpeakingRecording,
  SpeakingEvaluationResult,
  Subject,
  Unit,
  User,
  UserSubjectAssignmentResult,
  UserSession,
} from './types'

export class ApiError extends Error {
  status: number
  code: string
  field: string

  constructor(message: string, options?: { status?: number; code?: string; field?: string }) {
    super(message)
    this.name = 'ApiError'
    this.status = options?.status || 500
    this.code = options?.code || ''
    this.field = options?.field || ''
  }
}

const jsonFetch = async <T>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  const data = await response.json()
  if (!response.ok) {
    throw new ApiError(data?.error || '请求失败', {
      status: response.status,
      code: data?.code,
      field: data?.field,
    })
  }

  return data as T
}

export const getPublicAppData = () => jsonFetch<AppData & { bootstrapped: boolean; subjects: Subject[]; units: Unit[] }>('/api/app-data')

export const getUserSession = () => jsonFetch<UserSession>('/api/user/session')

export const loginUser = (username: string, password: string) =>
  jsonFetch<UserSession>('/api/user/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const logoutUser = () =>
  jsonFetch<{ ok: boolean }>('/api/user/logout', {
    method: 'POST',
  })

export const saveUserProgress = (progress: AppData['progress']) =>
  jsonFetch<AppData['progress']>('/api/user/progress', {
    method: 'POST',
    body: JSON.stringify(progress),
  })

export const createUser = (payload: { username: string; displayName: string; password: string; subjectId: string }) =>
  jsonFetch<User>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const updateUser = (userId: string, payload: { username: string; displayName: string; enabled: boolean }) =>
  jsonFetch<User>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

export const deleteUser = (userId: string) =>
  jsonFetch<{ ok: boolean }>(`/api/admin/users/${userId}`, {
    method: 'DELETE',
  })

export const resetUserPassword = (userId: string, newPassword: string) =>
  jsonFetch<{ ok: boolean }>(`/api/admin/users/${userId}/password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  })

export const assignUserSubject = (userId: string, subjectId: string | null) =>
  jsonFetch<UserSubjectAssignmentResult>(`/api/admin/users/${userId}/subject`, {
    method: 'POST',
    body: JSON.stringify({ subjectId }),
  })

export const getAdminSession = () => jsonFetch<AdminSession>('/api/admin/session')

export const bootstrapAdmin = (username: string, password: string) =>
  jsonFetch<{ ok: boolean }>('/api/admin/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const loginAdmin = (username: string, password: string) =>
  jsonFetch<{ ok: boolean; username: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const logoutAdmin = () =>
  jsonFetch<{ ok: boolean }>('/api/admin/logout', {
    method: 'POST',
  })

export const changeAdminPassword = (currentPassword: string, newPassword: string) =>
  jsonFetch<{ ok: boolean }>('/api/admin/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })

export const getAdminState = () => jsonFetch<AdminState>('/api/admin/state')

export const createSubject = (payload: { name: string; description: string }) =>
  jsonFetch<Subject>('/api/subjects', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const uploadSubjectImages = async (subjectId: string, files: File[]) => {
  const formData = new FormData()
  files.forEach((file) => formData.append('images', file))
  const response = await fetch(`/api/subjects/${subjectId}/images`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error || '图片上传失败')
  }

  return data
}

export const generateUnitDraft = (subjectId: string, imageIds: string[]) =>
  jsonFetch<Unit>(`/api/subjects/${subjectId}/generate-unit-draft`, {
    method: 'POST',
    body: JSON.stringify({ imageIds }),
  })

export const updateDraft = (draftId: string, payload: Partial<Unit>) =>
  jsonFetch<Unit>(`/api/drafts/${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

export const publishDraft = (draftId: string) =>
  jsonFetch<Unit>(`/api/drafts/${draftId}/publish`, {
    method: 'POST',
  })

export const saveProjectSettings = (payload: ProjectSettings) =>
  jsonFetch<ProjectSettings>('/api/settings/project', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

export const saveProviderSetting = (provider: ProviderId, payload: ProviderSetting) =>
  jsonFetch<ProviderSetting>(`/api/settings/providers/${provider}`, {
    method: 'PUT',
    body: JSON.stringify({
      apiMode: payload.apiMode,
      model: payload.model,
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      endpoint: payload.endpoint,
      reasoningEffort: payload.reasoningEffort,
      temperature: payload.temperature,
      maxOutputTokens: payload.maxOutputTokens,
      extra: {
        verbosity: payload.verbosity || 'medium',
        speechModel: payload.speechModel || '',
        ocrModel: payload.ocrModel || '',
        proxyUrl: payload.proxyUrl || '',
        accessKeyId: payload.accessKeyId || '',
        accessKeySecret: payload.accessKeySecret || '',
        regionId: payload.regionId || '',
        ocrType: payload.ocrType || '',
      },
      pricing: payload.pricing,
    }),
  })

export const uploadSpeakingRecording = async (audioFile: File, unitId: string, activityId: string, durationSeconds: number) => {
  const formData = new FormData()
  formData.append('audio', audioFile)
  formData.append('unitId', unitId)
  formData.append('activityId', activityId)
  formData.append('durationSeconds', String(durationSeconds))

  const response = await fetch('/api/speaking/recordings', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error || '录音上传失败')
  }

  return data as SpeakingRecording
}

export const getSpeakingRecordings = (unitId: string, activityId: string) =>
  jsonFetch<SpeakingRecording[]>(`/api/speaking/recordings?unitId=${encodeURIComponent(unitId)}&activityId=${encodeURIComponent(activityId)}`)

export const deleteSpeakingRecording = (recordingId: string) =>
  jsonFetch<{ ok: boolean }>(`/api/speaking/recordings/${recordingId}`, {
    method: 'DELETE',
  })

export const evaluateSpeaking = (recordingId: string, transcript: string) =>
  jsonFetch<SpeakingEvaluationResult & { recordingId: string }>('/api/speaking/evaluate', {
    method: 'POST',
    body: JSON.stringify({ recordingId, transcript }),
  })
