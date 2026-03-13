import { estimateUsageCost, getCapabilityPricing } from './pricing.js'
import { transcribeWithOpenAI } from './providers/openai-provider.js'
import { transcribeWithQwen } from './providers/qwen-provider.js'

const contractionMap = new Map([
  ["i'm", 'i am'],
  ["you're", 'you are'],
  ["we're", 'we are'],
  ["they're", 'they are'],
  ["it's", 'it is'],
  ["that's", 'that is'],
  ["there's", 'there is'],
  ["what's", 'what is'],
  ["can't", 'cannot'],
  ["won't", 'will not'],
  ["don't", 'do not'],
  ["doesn't", 'does not'],
  ["didn't", 'did not'],
  ["isn't", 'is not'],
  ["aren't", 'are not'],
  ["wasn't", 'was not'],
  ["weren't", 'were not'],
  ["haven't", 'have not'],
  ["hasn't", 'has not'],
  ["hadn't", 'had not'],
  ["i've", 'i have'],
  ["you've", 'you have'],
  ["we've", 'we have'],
  ["they've", 'they have'],
  ["i'll", 'i will'],
  ["you'll", 'you will'],
  ["we'll", 'we will'],
  ["they'll", 'they will'],
  ["i'd", 'i would'],
  ["you'd", 'you would'],
  ["we'd", 'we would'],
  ["they'd", 'they would'],
])

const STRICT_PASS_SCORE = 60

const countWords = (words) => {
  const counts = new Map()
  words.forEach((word) => {
    counts.set(word, (counts.get(word) || 0) + 1)
  })
  return counts
}

const listWordDiff = (sourceWords, targetWords) => {
  const sourceCounts = countWords(sourceWords)
  const targetCounts = countWords(targetWords)
  const diff = []

  sourceCounts.forEach((count, word) => {
    const remaining = count - (targetCounts.get(word) || 0)
    for (let index = 0; index < remaining; index += 1) {
      diff.push(word)
    }
  })

  return diff
}

export const normalizeSpeechText = (input = '') =>
  input
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:()[\]"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => contractionMap.get(token) || token)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

export const normalizeAudioInput = ({ mimeType = '', fileName = '' } = {}) => {
  const normalizedMimeType = String(mimeType).toLowerCase()
  const normalizedFileName = String(fileName).toLowerCase()

  if (normalizedMimeType.includes('webm')) {
    return { mimeType: 'audio/webm', fileName: 'speaking.webm' }
  }

  if (
    normalizedMimeType.includes('mp4') ||
    normalizedMimeType.includes('m4a') ||
    normalizedMimeType.includes('aac') ||
    normalizedFileName.endsWith('.m4a') ||
    normalizedFileName.endsWith('.mp4')
  ) {
    return { mimeType: 'audio/mp4', fileName: 'speaking.m4a' }
  }

  if (
    normalizedMimeType.includes('mpeg') ||
    normalizedMimeType.includes('mp3') ||
    normalizedFileName.endsWith('.mp3') ||
    normalizedFileName.endsWith('.mpeg')
  ) {
    return { mimeType: 'audio/mpeg', fileName: 'speaking.mp3' }
  }

  if (
    normalizedMimeType.includes('wav') ||
    normalizedMimeType.includes('wave') ||
    normalizedFileName.endsWith('.wav')
  ) {
    return { mimeType: 'audio/wav', fileName: 'speaking.wav' }
  }

  if (
    normalizedMimeType.includes('ogg') ||
    normalizedMimeType.includes('opus') ||
    normalizedFileName.endsWith('.ogg') ||
    normalizedFileName.endsWith('.opus')
  ) {
    return { mimeType: 'audio/ogg', fileName: 'speaking.ogg' }
  }

  if (normalizedFileName.endsWith('.webm')) {
    return { mimeType: 'audio/webm', fileName: 'speaking.webm' }
  }

  if (normalizedFileName.endsWith('.m4a') || normalizedFileName.endsWith('.mp4')) {
    return { mimeType: 'audio/mp4', fileName: 'speaking.m4a' }
  }

  if (normalizedFileName.endsWith('.mp3') || normalizedFileName.endsWith('.mpeg')) {
    return { mimeType: 'audio/mpeg', fileName: 'speaking.mp3' }
  }

  if (normalizedFileName.endsWith('.wav')) {
    return { mimeType: 'audio/wav', fileName: 'speaking.wav' }
  }

  if (normalizedFileName.endsWith('.ogg') || normalizedFileName.endsWith('.opus')) {
    return { mimeType: 'audio/ogg', fileName: 'speaking.ogg' }
  }

  return { mimeType: 'audio/webm', fileName: 'speaking.webm' }
}

const lcsLength = (a, b) => {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0))

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return dp[a.length][b.length]
}

export const scoreSpeakingTranscript = ({ targetTranscript, spokenTranscript, passScore = STRICT_PASS_SCORE }) => {
  const normalizedTarget = normalizeSpeechText(targetTranscript)
  const normalizedTranscript = normalizeSpeechText(spokenTranscript)
  const targetWords = normalizedTarget ? normalizedTarget.split(' ') : []
  const spokenWords = normalizedTranscript ? normalizedTranscript.split(' ') : []

  if (!spokenWords.length) {
    return {
      normalizedTarget,
      normalizedTranscript,
      score: 0,
      passed: false,
      mistakes: targetWords.slice(0, 3),
      feedback: '这次没有识别到清楚的跟读，先听示范，再慢慢读一遍。',
    }
  }

  if (normalizedTarget === normalizedTranscript) {
    return {
      normalizedTarget,
      normalizedTranscript,
      score: 100,
      passed: true,
      mistakes: [],
      feedback: '太棒了，这一句读得很完整。',
    }
  }

  const lcs = lcsLength(targetWords, spokenWords)
  const coverage = targetWords.length ? lcs / targetWords.length : 0
  const precision = spokenWords.length ? lcs / spokenWords.length : 0
  const orderScore = Math.max(targetWords.length, spokenWords.length) ? lcs / Math.max(targetWords.length, spokenWords.length) : 0
  const missingWords = listWordDiff(targetWords, spokenWords)
  const extraWords = listWordDiff(spokenWords, targetWords)
  const penalty = missingWords.length * 12 + extraWords.length * 9 + Math.abs(targetWords.length - spokenWords.length) * 4
  const baseScore = coverage * 0.45 + precision * 0.3 + orderScore * 0.25
  const score = Math.max(0, Math.min(100, Math.round(baseScore * 100 - penalty)))
  const mistakes = [...missingWords, ...extraWords.map((word) => `多读：${word}`)].slice(0, 4)
  const passed =
    score >= passScore &&
    missingWords.length === 0 &&
    extraWords.length === 0 &&
    coverage >= 0.98 &&
    precision >= 0.98

  let feedback = '已经很接近了，再跟着示范读一遍。'
  if (score >= 96 && !mistakes.length) {
    feedback = '这次读得很稳，发音和句子都很完整。'
  } else if (score >= 82) {
    feedback = `再重点读清这几个词：${mistakes.join('、') || '句子节奏'}。`
  } else if (mistakes.length) {
    feedback = `先慢一点，重点练习：${mistakes.join('、')}。`
  }

  return {
    normalizedTarget,
    normalizedTranscript,
    score,
    passed,
    mistakes,
    feedback,
  }
}

export const evaluateSpeakingSubmission = async ({
  activeAiVendor,
  openAiSetting,
  qwenSetting,
  audioBuffer,
  mimeType,
  fileName,
  durationSeconds = 0,
  targetTranscript,
  passScore = STRICT_PASS_SCORE,
  insertUsageLog,
}) => {
  const normalizedAudio = normalizeAudioInput({ mimeType, fileName })
  const transcription =
    activeAiVendor === 'openai'
      ? await transcribeWithOpenAI({
          setting: openAiSetting,
          audioBuffer,
          mimeType: normalizedAudio.mimeType,
          fileName: normalizedAudio.fileName,
        })
      : await transcribeWithQwen({
          setting: qwenSetting,
          audioBuffer,
          mimeType: normalizedAudio.mimeType,
        })

  const scoreResult = scoreSpeakingTranscript({
    targetTranscript,
    spokenTranscript: transcription.text,
    passScore,
  })

  const provider = activeAiVendor === 'openai' ? 'openai' : 'qwen'
  const model = activeAiVendor === 'openai' ? openAiSetting.speechModel || 'gpt-4o-mini-transcribe' : qwenSetting.speechModel || 'qwen3-asr-flash'
  const pricing = getCapabilityPricing(provider, 'speech', activeAiVendor === 'openai' ? openAiSetting.pricing : qwenSetting.pricing)
  const billableUsage = {
    ...transcription.usage,
    seconds: transcription.usage.seconds || durationSeconds || 0,
  }

  await insertUsageLog({
    timestamp: new Date().toISOString(),
    feature: 'speaking_evaluate',
    provider,
    model,
    inputTokens: transcription.usage.inputTokens || 0,
    outputTokens: transcription.usage.outputTokens || 0,
    totalTokens: transcription.usage.totalTokens || 0,
    estimatedCost: estimateUsageCost(pricing, billableUsage),
    currency: provider === 'openai' ? 'USD' : 'CNY',
    status: 'success',
    details: {
      targetTranscript,
      transcript: transcription.text,
      score: scoreResult.score,
      durationSeconds: billableUsage.seconds,
    },
  })

  return {
    transcript: transcription.text,
    normalizedTranscript: scoreResult.normalizedTranscript,
    normalizedTarget: scoreResult.normalizedTarget,
    score: scoreResult.score,
    passed: scoreResult.passed,
    feedback: scoreResult.feedback,
    mistakes: scoreResult.mistakes,
  }
}
