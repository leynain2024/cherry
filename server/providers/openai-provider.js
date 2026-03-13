import OpenAI, { toFile } from 'openai'
import { ProxyAgent } from 'undici'

const buildPrompt = (ocrText, subjectName) => `你是小学英语课程整理助手。
请基于下面的教材提取文本，为学科“${subjectName}”生成一个网站单元草稿。
必须输出严格 JSON，不要输出 markdown。

JSON 结构：
{
  "title": "Unit ...",
  "stage": "阶段...",
  "goal": "一句中文学习目标",
  "difficulty": "Starter|Bridge|Explorer",
  "coverEmoji": "一个 emoji",
  "themeColor": "#48a8f6",
  "vocabulary": [{"word":"","phonetic":"","meaning":"","imageLabel":"","example":""}],
  "patterns": [{"sentence":"","slots":[""],"demoLine":""}],
  "reading": {"title":"","content":"","audioText":"","question":""},
  "activities": {
    "listen": {"title":"","prompt":"","audioText":"","question":"","options":[{"id":"a","label":"","emoji":"🎯"}],"correctOptionId":"a"},
    "speak": {"title":"","prompt":"","transcript":"","hint":"","encouragement":["","",""]},
    "read": {"title":"","prompt":"","passage":"","question":"","options":[{"id":"a","label":"","emoji":"📘"}],"correctOptionId":"a"},
    "write": {"title":"","prompt":"","sentence":"","answer":"","tips":["",""]},
    "challenge": {"title":"","prompt":"","questions":[{"prompt":"","options":[{"id":"a","label":""}],"correctOptionId":"a"}]}
  }
}

要求：
1. 不要逐字复用教材原文，输出适合儿童网站的整理稿。
2. 保留教材范围、主题和能力目标。
3. vocabulary 至少 4 个词；patterns 至少 2 个句型；challenge 至少 2 题。
4. 所有字段必须完整。
5. 忽略图片里的手写批注、圈画、箭头、勾叉、铅笔涂改、课堂板书补充和非印刷体标记，不要把这些内容写入结果。

教材提取文本如下：
${ocrText}`

const proxyAgents = new Map()

const normalizeProxyUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

const getProxyAgent = (proxyUrl) => {
  const normalizedProxyUrl = normalizeProxyUrl(proxyUrl)
  if (!normalizedProxyUrl) {
    return null
  }

  if (!proxyAgents.has(normalizedProxyUrl)) {
    proxyAgents.set(normalizedProxyUrl, new ProxyAgent(normalizedProxyUrl))
  }

  return proxyAgents.get(normalizedProxyUrl)
}

const createClient = (setting) => {
  if (!setting.apiKey) {
    throw new Error('OpenAI API Key 未配置')
  }

  const proxyAgent = getProxyAgent(setting.proxyUrl)

  return new OpenAI({
    apiKey: setting.apiKey,
    baseURL: setting.baseUrl || 'https://api.openai.com/v1',
    timeout: 600000,
    maxRetries: 0,
    fetchOptions: proxyAgent
      ? {
          dispatcher: proxyAgent,
        }
      : undefined,
  })
}

const mapOpenAIError = (error) => {
  if (error?.status === 401) {
    return new Error('OpenAI API Key 无效或已过期')
  }

  if (error?.status === 429) {
    return new Error('OpenAI 请求过于频繁，请稍后重试')
  }

  if (error?.message === 'Request timed out.') {
    return new Error('OpenAI 响应等待超时，请稍后重试')
  }

  if (error?.message?.includes?.('fetch failed')) {
    return new Error('无法连接 OpenAI 服务器，请检查这台机器是否能访问 api.openai.com')
  }

  return error instanceof Error ? error : new Error('OpenAI 请求失败')
}

const normalizeTextUsage = (usage) => ({
  inputTokens: usage?.input_tokens || 0,
  outputTokens: usage?.output_tokens || 0,
  totalTokens: usage?.total_tokens || 0,
})

const normalizeAudioUsage = (usage) => {
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      seconds: 0,
    }
  }

  if (usage.type === 'duration') {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      seconds: usage.seconds || 0,
    }
  }

  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    seconds: 0,
  }
}

const normalizeSpeechFormat = (format = '') => {
  const normalized = String(format).trim().toLowerCase()
  if (normalized === 'wav') {
    return 'wav'
  }

  return 'mp3'
}

export const generateWithOpenAI = async ({ setting, ocrText, subjectName }) => {
  try {
    const client = createClient(setting)
    const response = await client.responses.create({
      model: setting.model || 'gpt-5.2',
      reasoning: setting.reasoningEffort ? { effort: setting.reasoningEffort } : undefined,
      max_output_tokens: setting.maxOutputTokens || 2048,
      input: buildPrompt(ocrText, subjectName),
      text: {
        format: {
          type: 'json_object',
        },
        verbosity: setting.verbosity || 'medium',
      },
    })

    return {
      content: response.output_text,
      usage: normalizeTextUsage(response.usage),
      raw: response,
    }
  } catch (error) {
    throw mapOpenAIError(error)
  }
}

export const extractTextWithOpenAI = async ({ setting, imageBuffer, mimeType = 'image/png' }) => {
  try {
    const client = createClient(setting)
    const response = await client.responses.create({
      model: setting.ocrModel || setting.model || 'gpt-5.2',
      reasoning: setting.reasoningEffort ? { effort: setting.reasoningEffort } : undefined,
      max_output_tokens: 2048,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: '你是教材 OCR 助手。请提取图片中的教材印刷文字，只返回纯文本，不要解释。忽略手写批注、圈画、箭头、勾叉、铅笔涂改、课堂补充和非印刷体标记。',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '请完整提取这页教材里的印刷版英文、中文、标题与练习文字，按自然换行输出。忽略手写字、批改痕迹、圈点连线和随手涂画。',
            },
            {
              type: 'input_image',
              image_url: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
            },
          ],
        },
      ],
      text: {
        verbosity: 'low',
      },
    })

    return {
      text: response.output_text.trim(),
      usage: normalizeTextUsage(response.usage),
      raw: response,
    }
  } catch (error) {
    throw mapOpenAIError(error)
  }
}

export const transcribeWithOpenAI = async ({ setting, audioBuffer, fileName = 'speaking.webm', mimeType }) => {
  try {
    const client = createClient(setting)
    const file = await toFile(audioBuffer, fileName, { type: mimeType || 'audio/webm' })
    const response = await client.audio.transcriptions.create({
      file,
      model: setting.speechModel || 'gpt-4o-mini-transcribe',
    })

    return {
      text: response.text || '',
      usage: normalizeAudioUsage(response.usage),
      raw: response,
    }
  } catch (error) {
    throw mapOpenAIError(error)
  }
}

export const synthesizeWithOpenAI = async ({ setting, text }) => {
  try {
    const client = createClient(setting)
    const format = normalizeSpeechFormat(setting.ttsFormat)
    const response = await client.audio.speech.create({
      model: setting.ttsModel || 'gpt-4o-mini-tts',
      voice: setting.ttsVoice || 'alloy',
      input: text,
      response_format: format,
      instructions: setting.ttsInstructions || undefined,
    })

    return {
      audioBuffer: Buffer.from(await response.arrayBuffer()),
      mimeType: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      extension: format,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 1,
      },
    }
  } catch (error) {
    throw mapOpenAIError(error)
  }
}
