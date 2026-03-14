import { randomUUID } from 'node:crypto'
import { jsonrepair } from 'jsonrepair'
import { estimateUsageCost, getCapabilityPricing } from './pricing.js'
import { runAliyunOcr } from './providers/aliyun-ocr.js'
import { extractTextWithOpenAI, generateWithOpenAI } from './providers/openai-provider.js'
import { generateWithQwen } from './providers/qwen-provider.js'

const defaultBlue = '#48a8f6'
const defaultRewardRule = {
  starsPerComplete: 2,
  starsPerPerfect: 3,
  unlockAtStars: 8,
  reviewTriggerMistakes: 2,
}
const alphabet = ['a', 'b', 'c', 'd', 'e', 'f']
const lessonTitlePattern = /lesson\s*\d+/i

const normalizeSkill = (value) => (['listen', 'speak', 'read', 'write'].includes(value) ? value : 'read')
const normalizeDifficulty = (value) => (['Starter', 'Bridge', 'Explorer'].includes(value) ? value : 'Starter')

const ensureOptions = (options = [], fallbackLabels = []) => {
  const normalized = Array.isArray(options) ? options : []
  if (normalized.length) {
    return normalized.slice(0, 4).map((option, index) => ({
      id: option.id || alphabet[index],
      label: option.label || `选项 ${index + 1}`,
      emoji: option.emoji || '⭐',
    }))
  }

  return fallbackLabels.slice(0, 4).map((label, index) => ({
    id: alphabet[index],
    label,
    emoji: '⭐',
  }))
}

const normalizePrompt = (value, fallback) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

const stripFenceMarker = (value) =>
  value.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

const collectFencedCandidates = (content) => {
  const matches = []
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let currentMatch = fencePattern.exec(content)
  while (currentMatch) {
    matches.push(stripFenceMarker(currentMatch[1] || ''))
    currentMatch = fencePattern.exec(content)
  }
  return matches.filter(Boolean)
}

const collectBalancedJsonCandidates = (content) => {
  const candidates = []
  const stack = []
  let startIndex = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if ((char === '{' || char === '[') && stack.length === 0) {
      startIndex = index
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }

    if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '['
      if (stack.at(-1) === expected) {
        stack.pop()
        if (stack.length === 0 && startIndex >= 0) {
          candidates.push(content.slice(startIndex, index + 1).trim())
          startIndex = -1
        }
      }
    }
  }

  return candidates.filter(Boolean)
}

const collectJsonCandidates = (content) => {
  const trimmed = stripFenceMarker(content)
  const candidates = [
    ...collectFencedCandidates(content),
    ...collectBalancedJsonCandidates(trimmed),
    trimmed,
  ]

  return Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean))).sort((left, right) => right.length - left.length)
}

const parseCandidate = (candidate) => {
  try {
    return JSON.parse(candidate)
  } catch (directError) {
    try {
      return JSON.parse(jsonrepair(candidate))
    } catch {
      throw directError
    }
  }
}

const looksLikeDraftPayload = (value) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ('title' in value || 'contentInventory' in value || 'vocabularyBank' in value || 'patterns' in value),
  )

export const parseJsonContent = (content) => {
  const candidates = collectJsonCandidates(content)
  let fallbackParsed = null

  for (const candidate of candidates) {
    if (!candidate.includes('{') && !candidate.includes('[')) {
      continue
    }

    try {
      const parsed = parseCandidate(candidate)
      if (looksLikeDraftPayload(parsed)) {
        return parsed
      }
      if (fallbackParsed == null) {
        fallbackParsed = parsed
      }
    } catch {
      continue
    }
  }

  if (fallbackParsed != null) {
    return fallbackParsed
  }

  throw new Error('模型未返回可解析 JSON')
}

const makeVocabularyKey = (word) => String(word || '').trim().toLowerCase()

const normalizeVocabularyBank = (items = [], sourceImageIds = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    id: item.id || `vocab-${randomUUID()}`,
    word: normalizePrompt(item.word, `word-${index + 1}`),
    phonetic: normalizePrompt(item.phonetic, '/demo/'),
    meaning: normalizePrompt(item.meaning, '待校对'),
    imageLabel: normalizePrompt(item.imageLabel, '待补充插图'),
    example: normalizePrompt(item.example, `Example sentence ${index + 1}.`),
    sourcePageIds: Array.isArray(item.sourcePageIds) && item.sourcePageIds.length ? item.sourcePageIds : sourceImageIds,
    sourceLessonLabel: normalizePrompt(item.sourceLessonLabel, 'LESSON 1'),
    relatedPatternIds: Array.isArray(item.relatedPatternIds) ? item.relatedPatternIds.filter(Boolean) : [],
    introducedInLessonId: typeof item.introducedInLessonId === 'string' ? item.introducedInLessonId : '',
    isCore: item.isCore !== false,
    audioText: normalizePrompt(item.audioText, item.word || ''),
    audioAssetId: typeof item.audioAssetId === 'string' ? item.audioAssetId : '',
    audioUrl: typeof item.audioUrl === 'string' ? item.audioUrl : '',
    audioMimeType: typeof item.audioMimeType === 'string' ? item.audioMimeType : '',
  }))

const normalizePatterns = (items = [], sourceImageIds = []) =>
  (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id || randomUUID(),
    sentence: normalizePrompt(item.sentence, 'This is ____.'),
    slots: Array.isArray(item.slots) && item.slots.length ? item.slots : ['demo'],
    demoLine: normalizePrompt(item.demoLine, item.sentence || 'This is ____.' ),
    sourcePageIds: Array.isArray(item.sourcePageIds) && item.sourcePageIds.length ? item.sourcePageIds : sourceImageIds,
    sourceLessonLabel: normalizePrompt(item.sourceLessonLabel, 'LESSON 1'),
  }))

const normalizeInventoryItems = (items = [], sourceImageIds = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    id: item.id || `inventory-${randomUUID()}`,
    sequence: Number(item.sequence) || index + 1,
    sourcePageIds: Array.isArray(item.sourcePageIds) && item.sourcePageIds.length ? item.sourcePageIds : sourceImageIds,
    sourceLessonLabel: normalizePrompt(item.sourceLessonLabel, 'LESSON 1'),
    sourceSectionLabel: normalizePrompt(item.sourceSectionLabel, '教材内容'),
    contentType: normalizePrompt(item.contentType, 'reading'),
    title: normalizePrompt(item.title, `教材内容 ${index + 1}`),
    skill: normalizeSkill(item.skill),
    estimatedMinutes: Math.max(1, Number(item.estimatedMinutes) || 2),
    vocabularyIds: Array.isArray(item.vocabularyIds) ? item.vocabularyIds.filter(Boolean) : [],
    content: typeof item.content === 'object' && item.content ? item.content : {},
  }))

const buildVocabularyMap = (vocabularyBank) => {
  const byId = new Map()
  const byWord = new Map()
  vocabularyBank.forEach((item) => {
    byId.set(item.id, item)
    byWord.set(makeVocabularyKey(item.word), item)
  })
  return { byId, byWord }
}

const resolveVocabularyRefs = ({ inventoryItem, vocabularyMap, fallbackLessonLabel }) => {
  const refs = [...inventoryItem.vocabularyIds]
  const words = Array.isArray(inventoryItem.content?.vocabularyWords) ? inventoryItem.content.vocabularyWords : []
  words.forEach((word) => {
    const vocab = vocabularyMap.byWord.get(makeVocabularyKey(word))
    if (vocab && !refs.includes(vocab.id)) {
      refs.push(vocab.id)
    }
  })
  if (refs.length) {
    return refs
  }

  return Array.from(vocabularyMap.byId.values())
    .filter((item) => item.sourceLessonLabel === fallbackLessonLabel)
    .slice(0, 4)
    .map((item) => item.id)
}

const buildChoiceQuestion = ({ title, prompt, options, correctOptionId, skill, durationMinutes, sourceInventoryIds, sourcePageIds }) => ({
  id: randomUUID(),
  title,
  prompt,
  skill,
  kind: skill === 'listen' ? 'listen-choice' : 'read-choice',
  durationMinutes,
  options,
  correctOptionId,
  sourceInventoryIds,
  sourcePageIds,
})

const createVocabActivitiesForWord = ({ vocabulary, modes, sourceInventoryIds, sourcePageIds }) =>
  modes.map((mode, index) => {
    if (mode === 'vocab-cn-write-en') {
      return {
        id: randomUUID(),
        title: `${vocabulary.word} 拼写站`,
        prompt: `看到中文意思，写出英文单词。`,
        skill: 'write',
        kind: 'vocab-cn-write-en',
        durationMinutes: 2,
        vocabularyId: vocabulary.id,
        word: vocabulary.word,
        meaning: vocabulary.meaning,
        answer: vocabulary.word,
        tips: [`中文：${vocabulary.meaning}`, '注意首字母和完整拼写。'],
        sourceInventoryIds,
        sourcePageIds,
        gameLabel: index === 0 ? '单词拼写' : '闯关拼写',
      }
    }

    if (mode === 'vocab-en-choose-zh') {
      const distractors = ['待校对', '课堂用品', '家庭成员', '数字']
      return {
        id: randomUUID(),
        title: `${vocabulary.word} 认一认`,
        prompt: '看英文，选出正确中文。',
        skill: 'read',
        kind: 'vocab-en-choose-zh',
        durationMinutes: 2,
        vocabularyId: vocabulary.id,
        word: vocabulary.word,
        question: `${vocabulary.word} 的意思是？`,
        options: ensureOptions(
          [
            { id: 'a', label: vocabulary.meaning, emoji: '📘' },
            ...distractors
              .filter((item) => item !== vocabulary.meaning)
              .slice(0, 2)
              .map((item, optionIndex) => ({ id: alphabet[optionIndex + 1], label: item, emoji: '📘' })),
          ],
        ),
        correctOptionId: 'a',
        sourceInventoryIds,
        sourcePageIds,
        gameLabel: '词义配对',
      }
    }

    if (mode === 'vocab-audio-write-en') {
      return {
        id: randomUUID(),
        title: `${vocabulary.word} 听写站`,
        prompt: '听标准读音，写出英文单词。',
        skill: 'write',
        kind: 'vocab-audio-write-en',
        durationMinutes: 2,
        vocabularyId: vocabulary.id,
        word: vocabulary.word,
        meaning: vocabulary.meaning,
        answer: vocabulary.word,
        tips: ['先听音频，再完整拼写。', `提示：${vocabulary.meaning}`],
        audioText: vocabulary.audioText || vocabulary.word,
        audioAssetId: vocabulary.audioAssetId,
        audioUrl: vocabulary.audioUrl,
        audioMimeType: vocabulary.audioMimeType,
        sourceInventoryIds,
        sourcePageIds,
        gameLabel: '听音拼写',
      }
    }

    return {
      id: randomUUID(),
      title: `${vocabulary.word} 听音选义`,
      prompt: '听标准读音，选出正确中文。',
      skill: 'listen',
      kind: 'vocab-audio-choose-zh',
      durationMinutes: 2,
      vocabularyId: vocabulary.id,
      word: vocabulary.word,
      question: '听到的单词是什么意思？',
      options: ensureOptions(
        [
          { id: 'a', label: vocabulary.meaning, emoji: '🎧' },
          { id: 'b', label: '问候语', emoji: '🎧' },
          { id: 'c', label: '课堂指令', emoji: '🎧' },
        ],
      ),
      correctOptionId: 'a',
      audioText: vocabulary.audioText || vocabulary.word,
      audioAssetId: vocabulary.audioAssetId,
      audioUrl: vocabulary.audioUrl,
      audioMimeType: vocabulary.audioMimeType,
      sourceInventoryIds,
      sourcePageIds,
      gameLabel: '听音选义',
    }
  })

const buildActivitiesFromInventoryItem = ({ item, vocabularyMap }) => {
  const sourceInventoryIds = [item.id]
  const sourcePageIds = item.sourcePageIds
  const content = item.content || {}
  const options = ensureOptions(content.options || [])

  if (item.contentType === 'listening') {
    return [
      {
        id: randomUUID(),
        title: item.title,
        prompt: normalizePrompt(content.prompt, '先听音频，再完成选择。'),
        skill: 'listen',
        kind: 'listen-choice',
        durationMinutes: item.estimatedMinutes,
        audioText: normalizePrompt(content.audioText, content.transcript || item.title),
        question: normalizePrompt(content.question, '请选择正确答案。'),
        options: options.length ? options : ensureOptions([], ['选项 A', '选项 B', '选项 C']),
        correctOptionId: normalizePrompt(content.correctOptionId, 'a'),
        sourceInventoryIds,
        sourcePageIds,
      },
    ]
  }

  if (item.contentType === 'dialogue' || item.contentType === 'speaking' || item.contentType === 'pronunciation' || item.contentType === 'pattern') {
    return [
      {
        id: randomUUID(),
        title: item.title,
        prompt: normalizePrompt(content.prompt, '听示范并跟读。'),
        skill: 'speak',
        kind: 'speak-repeat',
        durationMinutes: item.estimatedMinutes,
        transcript: normalizePrompt(content.transcript, content.audioText || item.title),
        audioText: normalizePrompt(content.audioText, content.transcript || item.title),
        hint: normalizePrompt(content.hint, '先听一遍，再开口说完整。'),
        encouragement: Array.isArray(content.encouragement) && content.encouragement.length
          ? content.encouragement.slice(0, 3)
          : ['发音很清楚', '语调很自然', '再来一次会更稳'],
        sourceInventoryIds,
        sourcePageIds,
      },
    ]
  }

  if (item.contentType === 'reading') {
    return [
      {
        id: randomUUID(),
        title: item.title,
        prompt: normalizePrompt(content.prompt, '读一读，再选择答案。'),
        skill: 'read',
        kind: 'read-choice',
        durationMinutes: item.estimatedMinutes,
        passage: normalizePrompt(content.passage, content.text || item.title),
        question: normalizePrompt(content.question, '请选择正确答案。'),
        options: options.length ? options : ensureOptions([], ['选项 A', '选项 B', '选项 C']),
        correctOptionId: normalizePrompt(content.correctOptionId, 'a'),
        sourceInventoryIds,
        sourcePageIds,
      },
    ]
  }

  if (item.contentType === 'writing') {
    return [
      {
        id: randomUUID(),
        title: item.title,
        prompt: normalizePrompt(content.prompt, '根据提示完成书写。'),
        skill: 'write',
        kind: 'write-spell',
        durationMinutes: item.estimatedMinutes,
        sentence: normalizePrompt(content.sentence, content.audioText || item.title),
        answer: normalizePrompt(content.answer, content.keyword || 'demo'),
        tips: Array.isArray(content.tips) && content.tips.length ? content.tips.slice(0, 3) : ['注意拼写。', '先回想课文。'],
        audioText: normalizePrompt(content.audioText, content.sentence || ''),
        sourceInventoryIds,
        sourcePageIds,
      },
    ]
  }

  if (item.contentType === 'assessment') {
    return [
      {
        id: randomUUID(),
        title: item.title,
        prompt: normalizePrompt(content.prompt, '完成本课小测。'),
        skill: 'write',
        kind: 'challenge',
        durationMinutes: item.estimatedMinutes,
        reviewIds: Array.isArray(content.reviewIds) ? content.reviewIds.filter(Boolean) : [],
        questions: (Array.isArray(content.questions) ? content.questions : []).slice(0, 4).map((question, index) => ({
          id: question.id || randomUUID(),
          prompt: normalizePrompt(question.prompt, `问题 ${index + 1}`),
          options: ensureOptions(question.options || []),
          correctOptionId: normalizePrompt(question.correctOptionId, 'a'),
        })),
        sourceInventoryIds,
        sourcePageIds,
      },
    ]
  }

  const refs = resolveVocabularyRefs({
    inventoryItem: item,
    vocabularyMap,
    fallbackLessonLabel: item.sourceLessonLabel,
  })
  return refs
    .map((id) => vocabularyMap.byId.get(id))
    .filter(Boolean)
    .slice(0, 2)
    .flatMap((vocabulary) =>
      createVocabActivitiesForWord({
        vocabulary,
        modes: vocabulary.isCore ? ['vocab-en-choose-zh'] : ['vocab-en-choose-zh'],
        sourceInventoryIds,
        sourcePageIds,
      }),
    )
}

const groupInventoryByLesson = (inventory) => {
  const groups = new Map()
  inventory
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((item) => {
      const key = item.sourceLessonLabel || 'LESSON 1'
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push(item)
    })
  return Array.from(groups.entries()).sort(([left], [right]) => {
    const leftMatch = left.match(/\d+/)
    const rightMatch = right.match(/\d+/)
    return Number(leftMatch?.[0] || 0) - Number(rightMatch?.[0] || 0)
  })
}

const buildDerivedActivity = ({ skill, lessonLabel, vocabulary }) => {
  if (!vocabulary) {
    return null
  }

  if (skill === 'listen') {
    return createVocabActivitiesForWord({
      vocabulary,
      modes: ['vocab-audio-choose-zh'],
      sourceInventoryIds: [],
      sourcePageIds: vocabulary.sourcePageIds,
    })[0]
  }

  if (skill === 'speak') {
    return {
      id: randomUUID(),
      title: `${lessonLabel} 说一说`,
      prompt: '用本课词句做简短跟读。',
      skill: 'speak',
      kind: 'speak-repeat',
      durationMinutes: 2,
      transcript: vocabulary.example || `${vocabulary.word}.`,
      audioText: vocabulary.example || vocabulary.word,
      hint: '先听后说，语速放慢一点。',
      encouragement: ['说得越来越自然了', '继续保持完整句子', '很好，再试一次'],
      sourceInventoryIds: [],
      sourcePageIds: vocabulary.sourcePageIds,
    }
  }

  if (skill === 'read') {
    return createVocabActivitiesForWord({
      vocabulary,
      modes: ['vocab-en-choose-zh'],
      sourceInventoryIds: [],
      sourcePageIds: vocabulary.sourcePageIds,
    })[0]
  }

  return createVocabActivitiesForWord({
    vocabulary,
    modes: ['vocab-cn-write-en'],
    sourceInventoryIds: [],
    sourcePageIds: vocabulary.sourcePageIds,
  })[0]
}

const ensureAllSkills = ({ lessonLabel, activities, lessonVocabulary }) => {
  const requiredSkills = ['listen', 'speak', 'read', 'write']
  const existing = new Set(activities.map((activity) => activity.skill))
  const next = [...activities]

  requiredSkills.forEach((skill) => {
    if (existing.has(skill)) {
      return
    }

    const vocabulary = lessonVocabulary.find(Boolean)
    const derived = buildDerivedActivity({ skill, lessonLabel, vocabulary })
    if (derived) {
      next.push(derived)
      existing.add(skill)
    }
  })

  return next
}

const chunkActivities = ({ lessonLabel, activities, lessonVocabulary, minMinutes, maxMinutes }) => {
  const chunks = []
  let current = []
  let currentMinutes = 0

  activities.forEach((activity) => {
    const nextMinutes = currentMinutes + (activity.durationMinutes || 0)
    if (current.length && nextMinutes > maxMinutes && currentMinutes >= minMinutes) {
      chunks.push(ensureAllSkills({ lessonLabel, activities: current, lessonVocabulary }))
      current = []
      currentMinutes = 0
    }

    current.push(activity)
    currentMinutes += activity.durationMinutes || 0
  })

  if (current.length) {
    chunks.push(ensureAllSkills({ lessonLabel, activities: current, lessonVocabulary }))
  }

  return chunks
}

const buildLessonQuiz = ({ lesson, lessonVocabulary }) => {
  const vocabulary = lessonVocabulary.slice(0, 2)
  if (!vocabulary.length) {
    return null
  }

  return {
    id: randomUUID(),
    title: `${lesson.title} 小测`,
    prompt: '完成本节的小测验。',
    skill: 'write',
    kind: 'challenge',
    durationMinutes: 3,
    reviewIds: lesson.activities.slice(0, 3).map((activity) => activity.id),
    questions: vocabulary.map((item, index) => ({
      id: randomUUID(),
      prompt: `${item.word} 的中文意思是？`,
      options: ensureOptions([
        { id: 'a', label: item.meaning },
        { id: 'b', label: '课堂问候' },
        { id: 'c', label: '书写练习' },
      ]),
      correctOptionId: 'a',
    })).slice(0, Math.max(2, Math.min(3, vocabulary.length + 1))),
    sourceInventoryIds: [],
    sourcePageIds: lesson.sourcePageIds,
  }
}

const buildLessonSections = (activities) =>
  ['listen', 'speak', 'read', 'write'].map((skill) => ({
    id: randomUUID(),
    skill,
    title: skill === 'listen' ? '听' : skill === 'speak' ? '说' : skill === 'read' ? '读' : '写',
    activityIds: activities.filter((activity) => activity.skill === skill).map((activity) => activity.id),
    estimatedMinutes: activities
      .filter((activity) => activity.skill === skill)
      .reduce((total, activity) => total + (activity.durationMinutes || 0), 0),
  }))

const buildUnitAssessment = ({ title, prompt, lessons, vocabularyBank }) => {
  if (lessons.length < 2) {
    return null
  }

  const questions = vocabularyBank.slice(0, 4).map((item, index) => ({
    id: randomUUID(),
    prompt: index % 2 === 0 ? `${item.word} 的意思是？` : `请选出听到的单词对应的中文。`,
    options: ensureOptions([
      { id: 'a', label: item.meaning },
      { id: 'b', label: '课堂活动' },
      { id: 'c', label: '语音训练' },
    ]),
    correctOptionId: 'a',
  }))
  if (!questions.length) {
    return null
  }

  return {
    id: randomUUID(),
    title,
    prompt,
    durationMinutes: 5,
    reviewIds: lessons.flatMap((lesson) => lesson.activities.slice(0, 2).map((activity) => activity.id)).slice(0, 8),
    questions,
  }
}

const flattenLessonActivities = (lessons = []) =>
  lessons.flatMap((lesson) =>
    lesson.activities.map((activity) => ({
      ...activity,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
    })),
  )

const deriveReadingSummary = (lessons = []) => {
  const activity = flattenLessonActivities(lessons).find((item) => item.kind === 'read-choice')
  return {
    id: activity ? `reading-${activity.id}` : randomUUID(),
    title: activity?.title || '阅读内容',
    content: activity?.passage || '',
    audioText: activity?.audioText || '',
    question: activity?.question || '',
  }
}

const buildLessons = ({ inventory, vocabularyBank, minMinutes, maxMinutes }) => {
  const vocabularyMap = buildVocabularyMap(vocabularyBank)
  const lessonGroups = groupInventoryByLesson(inventory)
  const lessons = []

  lessonGroups.forEach(([lessonLabel, items]) => {
    const lessonVocabulary = vocabularyBank.filter((item) => item.sourceLessonLabel === lessonLabel)
    const vocabActivities = lessonVocabulary.flatMap((vocabulary) =>
      createVocabActivitiesForWord({
        vocabulary,
        modes: vocabulary.isCore
          ? ['vocab-en-choose-zh', 'vocab-cn-write-en', 'vocab-audio-choose-zh', 'vocab-audio-write-en']
          : ['vocab-en-choose-zh', 'vocab-audio-choose-zh', 'vocab-cn-write-en'],
        sourceInventoryIds: [],
        sourcePageIds: vocabulary.sourcePageIds,
      }),
    )
    const originalActivities = items.flatMap((item) => buildActivitiesFromInventoryItem({ item, vocabularyMap }))
    const activityPool = [...vocabActivities, ...originalActivities]
    const chunks = chunkActivities({
      lessonLabel,
      activities: activityPool,
      lessonVocabulary,
      minMinutes,
      maxMinutes,
    })

    chunks.forEach((activities, chunkIndex) => {
      const titleBase = lessonTitlePattern.test(lessonLabel) ? lessonLabel : `Lesson ${lessons.length + 1}`
      const title = chunks.length > 1 ? `${titleBase} · 第 ${chunkIndex + 1} 份` : titleBase
      const sourcePageIds = Array.from(new Set(activities.flatMap((activity) => activity.sourcePageIds || [])))
      const vocabularyRefs = Array.from(new Set(lessonVocabulary.map((item) => item.id)))
      const lessonId = `lesson-${randomUUID()}`
      const lesson = {
        id: lessonId,
        title,
        order: lessons.length + 1,
        estimatedMinutes: activities.reduce((total, activity) => total + (activity.durationMinutes || 0), 0),
        sourcePageIds,
        sourceLessonLabel: lessonLabel,
        vocabularyRefs,
        sections: buildLessonSections(activities),
        activities: activities.map((activity) => ({
          ...activity,
          lessonId,
          lessonTitle: title,
        })),
        lessonQuiz: null,
      }
      lesson.lessonQuiz = buildLessonQuiz({ lesson, lessonVocabulary })
      lessons.push(lesson)
    })
  })

  return lessons
}

export const buildDraftUnitFromModel = ({ subjectId, subjectName, sourceImageIds, parsed, projectSettings }) => {
  const vocabularyBank = normalizeVocabularyBank(parsed.vocabularyBank || parsed.vocabulary || [], sourceImageIds)
  const patterns = normalizePatterns(parsed.patterns || [], sourceImageIds)
  const contentInventory = normalizeInventoryItems(parsed.contentInventory || parsed.inventory || [], sourceImageIds)
  const lessons = buildLessons({
    inventory: contentInventory,
    vocabularyBank,
    minMinutes: projectSettings.dailyLessonMinMinutes,
    maxMinutes: projectSettings.dailyLessonMaxMinutes,
  })

  return {
    id: `draft-${randomUUID()}`,
    subjectId,
    title: parsed.title || 'Untitled Draft Unit',
    source: '教材图片整理',
    stage: parsed.stage || `${subjectName} · 待校对`,
    goal: parsed.goal || '请根据教材图片补充学习目标。',
    difficulty: normalizeDifficulty(parsed.difficulty),
    unlockOrder: Date.now(),
    coverEmoji: parsed.coverEmoji || '📘',
    themeColor: parsed.themeColor || defaultBlue,
    status: 'draft',
    contentOrigin: 'imported',
    sourceImageIds,
    rewardRule: { ...defaultRewardRule },
    vocabularyBank,
    patterns,
    contentInventory,
    lessons,
    unitReview: buildUnitAssessment({
      title: '单元复习',
      prompt: '先回顾本单元的核心词句，再完成复习题。',
      lessons,
      vocabularyBank,
    }),
    unitTest: buildUnitAssessment({
      title: '单元测试',
      prompt: '完成单元综合测试。',
      lessons,
      vocabularyBank,
    }),
    vocabulary: vocabularyBank,
    reading: deriveReadingSummary(lessons),
    activities: flattenLessonActivities(lessons),
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
  projectSettings,
  subject,
  ocrText,
  subjectId,
  sourceImageIds,
  insertUsageLog,
  jobId,
  onProgress,
  onModelResponse,
  onParsedPayload,
}) => {
  let response
  const requestedMaxOutputTokens =
    providerSetting.provider === 'openai'
      ? Math.max(Number(providerSetting.maxOutputTokens) || 0, 8192)
      : Number(providerSetting.maxOutputTokens) || 2048
  await onProgress?.({
    stage: 'draft',
    processedImages: sourceImageIds.length,
    totalImages: sourceImageIds.length,
    message: 'OCR 已完成，正在生成教材内容清单并拆分 lessons。',
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
    details: {
      sourceImageIds,
      dailyLessonMinMinutes: projectSettings.dailyLessonMinMinutes,
      dailyLessonMaxMinutes: projectSettings.dailyLessonMaxMinutes,
    },
  })

  await onModelResponse?.({
    content: response.content,
    usage: response.usage,
  })

  let parsed
  try {
    parsed = parseJsonContent(response.content)
  } catch (error) {
    if ((response.usage?.outputTokens || 0) >= requestedMaxOutputTokens) {
      throw new Error(`单元草稿输出达到 ${requestedMaxOutputTokens} token 上限，疑似被截断。请提高最大输出 token 后重试。`)
    }
    throw error
  }
  await onParsedPayload?.(parsed)
  return buildDraftUnitFromModel({
    subjectId,
    subjectName: subject.name,
    sourceImageIds,
    parsed,
    projectSettings,
  })
}
