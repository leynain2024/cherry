import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { estimateUsageCost, getCapabilityPricing } from './pricing.js'
import { synthesizeWithOpenAI } from './providers/openai-provider.js'
import { synthesizeWithQwen } from './providers/qwen-provider.js'

const buildAudioTasks = (unit) =>
  unit.activities.flatMap((activity) => {
    if (activity.kind === 'listen-choice' && activity.audioText?.trim()) {
      return [{ activityId: activity.id, role: 'listen', text: activity.audioText.trim() }]
    }

    if (activity.kind === 'speak-repeat' && activity.transcript?.trim()) {
      return [{ activityId: activity.id, role: 'speak', text: activity.transcript.trim() }]
    }

    if (activity.kind === 'write-spell' && activity.sentence?.trim()) {
      return [{ activityId: activity.id, role: 'dictation', text: activity.sentence.trim() }]
    }

    return []
  })

const hashAudioTask = ({ provider, model, voice, format, instructions, languageType, text }) =>
  createHash('sha256').update([provider, model, voice, format, instructions, languageType, text].join('::')).digest('hex').slice(0, 16)

const normalizeAudioPathPart = (value) => String(value || '').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

const getAudioFileName = ({ unitId, activityId, role, hash, extension }) =>
  `${normalizeAudioPathPart(unitId)}-${normalizeAudioPathPart(activityId)}-${role}-${hash}.${extension}`

const buildPublicAudioUrl = (fileName) => `/audio-assets/${fileName}`

const synthesizeByProvider = async ({ activeAiVendor, openAiSetting, qwenSetting, text }) => {
  if (activeAiVendor === 'openai') {
    if (!openAiSetting) {
      throw new Error('OpenAI 配置不存在，无法生成教学音频')
    }
    return synthesizeWithOpenAI({
      setting: openAiSetting,
      text,
    })
  }

  if (!qwenSetting) {
    throw new Error('通义配置不存在，无法生成教学音频')
  }

  return synthesizeWithQwen({
    setting: qwenSetting,
    text,
  })
}

const getTtsConfig = ({ activeAiVendor, openAiSetting, qwenSetting }) => {
  if (activeAiVendor === 'openai') {
    if (!openAiSetting) {
      throw new Error('OpenAI 配置不存在，无法生成教学音频')
    }
    return {
      provider: 'openai',
      model: openAiSetting.ttsModel || 'gpt-4o-mini-tts',
      voice: openAiSetting.ttsVoice || 'alloy',
      format: openAiSetting.ttsFormat || 'mp3',
      instructions: openAiSetting.ttsInstructions || '',
      languageType: '',
      pricing: getCapabilityPricing('openai', 'tts', openAiSetting.pricing),
      currency: 'USD',
    }
  }

  if (!qwenSetting) {
    throw new Error('通义配置不存在，无法生成教学音频')
  }

  return {
    provider: 'qwen',
    model: qwenSetting.ttsModel || 'qwen3-tts-flash',
    voice: qwenSetting.ttsVoice || 'Cherry',
    format: qwenSetting.ttsFormat || 'wav',
    instructions: qwenSetting.ttsInstructions || '',
    languageType: qwenSetting.ttsLanguageType || 'English',
    pricing: getCapabilityPricing('qwen', 'tts', qwenSetting.pricing),
    currency: 'CNY',
  }
}

export const generateUnitAudioAssets = async ({
  activeAiVendor,
  openAiSetting,
  qwenSetting,
  audioAssetsDir,
  unit,
  subjectId,
  insertUsageLog,
}) => {
  const tasks = buildAudioTasks(unit)
  if (!tasks.length) {
    return unit
  }

  const ttsConfig = getTtsConfig({ activeAiVendor, openAiSetting, qwenSetting })
  const activityAudioMap = new Map()

  for (const task of tasks) {
    const hash = hashAudioTask({
      provider: ttsConfig.provider,
      model: ttsConfig.model,
      voice: ttsConfig.voice,
      format: ttsConfig.format,
      instructions: ttsConfig.instructions,
      languageType: ttsConfig.languageType,
      text: task.text,
    })
    const fileName = getAudioFileName({
      unitId: unit.id,
      activityId: task.activityId,
      role: task.role,
      hash,
      extension: ttsConfig.format,
    })
    const filePath = path.join(audioAssetsDir, fileName)

    if (!fs.existsSync(filePath)) {
      const result = await synthesizeByProvider({
        activeAiVendor,
        openAiSetting,
        qwenSetting,
        text: task.text,
      })
      fs.writeFileSync(filePath, result.audioBuffer)

      await insertUsageLog({
        timestamp: new Date().toISOString(),
        subjectId,
        feature: 'tts_generate',
        provider: ttsConfig.provider,
        model: ttsConfig.model,
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
        estimatedCost: estimateUsageCost(ttsConfig.pricing, result.usage || { requestCount: 1 }),
        currency: ttsConfig.currency,
        status: 'success',
        details: {
          unitId: unit.id,
          activityId: task.activityId,
          role: task.role,
          voice: ttsConfig.voice,
          format: result.extension,
        },
      })
    }

    activityAudioMap.set(task.activityId, {
      audioUrl: buildPublicAudioUrl(fileName),
      audioMimeType: ttsConfig.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    })
  }

  return {
    ...unit,
    activities: unit.activities.map((activity) => {
      const audio = activityAudioMap.get(activity.id)
      if (!audio || (activity.kind !== 'listen-choice' && activity.kind !== 'speak-repeat' && activity.kind !== 'write-spell')) {
        return activity
      }

      return {
        ...activity,
        audioUrl: audio.audioUrl,
        audioMimeType: audio.audioMimeType,
      }
    }),
  }
}
