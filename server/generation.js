import { randomUUID } from 'node:crypto'
import { jsonrepair } from 'jsonrepair'
import { estimateUsageCost, getCapabilityPricing } from './pricing.js'
import { runAliyunOcr } from './providers/aliyun-ocr.js'
import { extractTextWithOpenAI, generateWithOpenAI } from './providers/openai-provider.js'
import { generateWithQwen } from './providers/qwen-provider.js'

const defaultBlue = '#48a8f6'

const toVocabulary = (items = []) =>
  items.slice(0, 8).map((item, index) => ({
    id: item.id || randomUUID(),
    word: item.word || `word-${index + 1}`,
    phonetic: item.phonetic || '/demo/',
    meaning: item.meaning || '待校对',
    imageLabel: item.imageLabel || '待补充插图',
    example: item.example || `Example sentence ${index + 1}.`,
  }))

const toPatterns = (items = []) =>
  items.slice(0, 4).map((item) => ({
    id: item.id || randomUUID(),
    sentence: item.sentence || 'This is ___.',
    slots: Array.isArray(item.slots) && item.slots.length ? item.slots : ['demo'],
    demoLine: item.demoLine || 'This is a demo line.',
  }))

const ensureOptions = (options = []) =>
  options.slice(0, 4).map((option, index) => ({
    id: option.id || String.fromCharCode(97 + index),
    label: option.label || `Option ${index + 1}`,
    emoji: option.emoji || '⭐',
  }))

const buildActivities = (payload, vocabulary) => {
  const activities = payload.activities || {}
  return [
    {
      id: randomUUID(),
      title: '热身词卡',
      prompt: '先看看图片，把今天的词汇认熟。',
      skill: 'read',
      kind: 'warmup',
      durationMinutes: 2,
      cards: vocabulary,
    },
    {
      id: randomUUID(),
      title: activities.listen?.title || '听音选意思',
      prompt: activities.listen?.prompt || '听一听老师说了什么。',
      skill: 'listen',
      kind: 'listen-choice',
      durationMinutes: 2,
      audioText: activities.listen?.audioText || '',
      question: activities.listen?.question || '请选择正确答案',
      options: ensureOptions(activities.listen?.options || []),
      correctOptionId: activities.listen?.correctOptionId || 'a',
    },
    {
      id: randomUUID(),
      title: activities.speak?.title || '跟读练习',
      prompt: activities.speak?.prompt || '听示范并跟读。',
      skill: 'speak',
      kind: 'speak-repeat',
      durationMinutes: 2,
      transcript: activities.speak?.transcript || '',
      hint: activities.speak?.hint || '先听一遍，再完整跟读。',
      encouragement: Array.isArray(activities.speak?.encouragement) && activities.speak.encouragement.length
        ? activities.speak.encouragement
        : ['发音清楚', '节奏不错', '再试一次会更好'],
    },
    {
      id: randomUUID(),
      title: activities.read?.title || '阅读理解',
      prompt: activities.read?.prompt || '读一读，再回答问题。',
      skill: 'read',
      kind: 'read-choice',
      durationMinutes: 3,
      passage: activities.read?.passage || payload.reading?.content || '',
      question: activities.read?.question || '请选择正确答案',
      options: ensureOptions(activities.read?.options || []),
      correctOptionId: activities.read?.correctOptionId || 'a',
    },
    {
      id: randomUUID(),
      title: activities.write?.title || '拼写练习',
      prompt: activities.write?.prompt || '写出句子中的核心词。',
      skill: 'write',
      kind: 'write-spell',
      durationMinutes: 2,
      sentence: activities.write?.sentence || 'Write here.',
      answer: activities.write?.answer || 'demo',
      tips: Array.isArray(activities.write?.tips) && activities.write.tips.length
        ? activities.write.tips
        : ['根据意思填写。', '注意拼写。'],
    },
    {
      id: randomUUID(),
      title: activities.challenge?.title || '单元挑战',
      prompt: activities.challenge?.prompt || '把今天的内容串起来完成挑战。',
      skill: 'write',
      kind: 'challenge',
      durationMinutes: 3,
      reviewIds: [],
      questions: (activities.challenge?.questions || []).slice(0, 4).map((question, index) => ({
        id: question.id || randomUUID(),
        prompt: question.prompt || `Challenge ${index + 1}`,
        options: ensureOptions(question.options || []),
        correctOptionId: question.correctOptionId || 'a',
      })),
    },
  ]
}

const extractJsonCandidate = (content) => {
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match ? match[0] : trimmed
}

export const parseJsonContent = (content) => {
  const candidate = extractJsonCandidate(content)
  try {
    return JSON.parse(candidate)
  } catch (directError) {
    if (!candidate.includes('{')) {
      throw new Error('模型未返回可解析 JSON')
    }

    try {
      return JSON.parse(jsonrepair(candidate))
    } catch {
      throw directError
    }
  }
}

export const buildDraftUnitFromModel = ({ subjectId, subjectName, sourceImageIds, parsed }) => {
  const vocabulary = toVocabulary(parsed.vocabulary)
  const patterns = toPatterns(parsed.patterns)
  const reading = {
    id: randomUUID(),
    title: parsed.reading?.title || 'Reading',
    content: parsed.reading?.content || '',
    audioText: parsed.reading?.audioText || '',
    question: parsed.reading?.question || '请选择正确答案',
  }

  return {
    id: `draft-${randomUUID()}`,
    subjectId,
    title: parsed.title || 'Untitled Draft Unit',
    source: '教材图片整理',
    stage: parsed.stage || `${subjectName} · 待校对`,
    goal: parsed.goal || '请根据教材图片补充学习目标。',
    difficulty: ['Starter', 'Bridge', 'Explorer'].includes(parsed.difficulty) ? parsed.difficulty : 'Starter',
    unlockOrder: Date.now(),
    coverEmoji: parsed.coverEmoji || '📘',
    themeColor: parsed.themeColor || defaultBlue,
    status: 'draft',
    contentOrigin: 'imported',
    sourceImageIds,
    rewardRule: {
      starsPerComplete: 2,
      starsPerPerfect: 3,
      unlockAtStars: 8,
      reviewTriggerMistakes: 2,
    },
    vocabulary,
    patterns,
    reading,
    activities: buildActivities(parsed, vocabulary),
  }
}

export const runOcrForImages = async ({
  activeAiVendor,
  openAiSetting,
  ocrSetting,
  imageRecords,
  insertUsageLog,
  subjectId,
  jobId,
  onProgress,
}) => {
  const pages = []

  for (const [index, image] of imageRecords.entries()) {
    let result
    try {
      result =
        activeAiVendor === 'openai'
          ? await extractTextWithOpenAI({
              setting: openAiSetting,
              imageBuffer: image.buffer,
              mimeType: image.mimeType,
            })
          : await runAliyunOcr({
              setting: ocrSetting,
              imageBuffer: image.buffer,
            })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'OCR 失败'
      if (detail.includes('超时')) {
        throw new Error(`教材 OCR 第 ${index + 1}/${imageRecords.length} 张等待超时，请稍后重试。`)
      }
      throw new Error(`教材 OCR 第 ${index + 1}/${imageRecords.length} 张失败：${detail}`)
    }

    const provider = activeAiVendor === 'openai' ? 'openai' : 'aliyun-ocr'
    const model = activeAiVendor === 'openai' ? openAiSetting.ocrModel || openAiSetting.model : ocrSetting.ocrType || 'RecognizeAllText'
    const pricing = getCapabilityPricing(provider, 'ocr', activeAiVendor === 'openai' ? openAiSetting.pricing : ocrSetting.pricing)

    await insertUsageLog({
      timestamp: new Date().toISOString(),
      subjectId,
      feature: 'ocr_extract',
      provider,
      model,
      inputTokens: result.usage?.inputTokens || 0,
      outputTokens: result.usage?.outputTokens || 0,
      totalTokens: result.usage?.totalTokens || 0,
      estimatedCost: estimateUsageCost(pricing, result.usage || { requestCount: 1 }),
      currency: provider === 'openai' ? 'USD' : 'CNY',
      status: 'success',
      jobId,
      details: { imageId: image.id, fileName: image.fileName },
    })

    pages.push(`## ${image.fileName}\n${result.text}`)

    await onProgress?.({
      stage: 'ocr',
      processedImages: index + 1,
      totalImages: imageRecords.length,
      message:
        index + 1 < imageRecords.length
          ? `正在识别教材图片（${index + 1}/${imageRecords.length}）`
          : '教材 OCR 已完成，准备整理单元草稿。',
    })
  }

  return pages.join('\n\n')
}

export const runDraftGeneration = async ({
  providerSetting,
  subject,
  ocrText,
  subjectId,
  sourceImageIds,
  insertUsageLog,
  jobId,
  onProgress,
}) => {
  let response
  await onProgress?.({
    stage: 'draft',
    processedImages: sourceImageIds.length,
    totalImages: sourceImageIds.length,
    message: 'OCR 已完成，正在生成单元草稿。',
  })

  try {
    if (providerSetting.provider === 'openai') {
      response = await generateWithOpenAI({
        setting: providerSetting,
        ocrText,
        subjectName: subject.name,
      })
    } else if (providerSetting.provider === 'qwen') {
      response = await generateWithQwen({
        setting: providerSetting,
        ocrText,
        subjectName: subject.name,
      })
    } else {
      throw new Error('不支持的模型供应商')
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '草稿生成失败'
    if (detail.includes('超时')) {
      throw new Error('单元草稿整理等待超时，前面的 OCR 已完成。请稍后重试，或减少本次图片数量。')
    }
    throw new Error(`单元草稿整理失败：${detail}`)
  }

  await insertUsageLog({
    timestamp: new Date().toISOString(),
    subjectId,
    feature: 'unit_draft_generate',
    provider: providerSetting.provider,
    model: providerSetting.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    estimatedCost: estimateUsageCost(getCapabilityPricing(providerSetting.provider, 'text', providerSetting.pricing), response.usage),
    currency: providerSetting.provider === 'openai' ? 'USD' : 'CNY',
    status: 'success',
    jobId,
    details: { sourceImageIds },
  })

  const parsed = parseJsonContent(response.content)
  return buildDraftUnitFromModel({
    subjectId,
    subjectName: subject.name,
    sourceImageIds,
    parsed,
  })
}
