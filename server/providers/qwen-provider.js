const buildMessages = (ocrText, subjectName) => [
  {
    role: 'system',
    content:
      '你是小学英语课程整理助手。请把 OCR 文本整理成完整教材内容清单，只输出 JSON。',
  },
  {
    role: 'user',
    content: `请为学科“${subjectName}”生成一个完整教材内容清单，字段要求如下：
{
  "title": "Unit ...",
  "stage": "阶段...",
  "goal": "一句中文学习目标",
  "difficulty": "Starter|Bridge|Explorer",
  "coverEmoji": "一个 emoji",
  "themeColor": "#48a8f6",
  "vocabularyBank": [{"word":"","phonetic":"","meaning":"","imageLabel":"","example":"","sourceLessonLabel":"","sourcePageIds":["01.jpg"],"isCore":true}],
  "patterns": [{"sentence":"","slots":[""],"demoLine":"","sourceLessonLabel":"","sourcePageIds":["01.jpg"]}],
  "contentInventory": [
    {
      "sequence": 1,
      "sourceLessonLabel": "LESSON 1",
      "sourceSectionLabel": "Guided Conversation",
      "contentType": "dialogue|listening|speaking|reading|writing|pronunciation|pattern|assessment|vocabulary",
      "title": "",
      "skill": "listen|speak|read|write",
      "estimatedMinutes": 2,
      "sourcePageIds": ["04.jpg"],
      "vocabularyIds": [],
      "content": {
        "prompt": "",
        "audioText": "",
        "transcript": "",
        "passage": "",
        "sentence": "",
        "answer": "",
        "question": "",
        "options": [{"id":"a","label":"","emoji":"⭐"}],
        "correctOptionId": "a",
        "tips": [""],
        "questions": [{"prompt":"","options":[{"id":"a","label":""}],"correctOptionId":"a"}],
        "vocabularyWords": [""]
      }
    }
  ]
}

要求：先完整提取教材全部教学内容，不要为了压缩时长省略内容；必须覆盖每个教材板块，包括词汇、对话、数字、听力、口语、阅读、书写、句型、练习和测验；同一页里如果有多个板块，必须拆成多个 contentInventory 条目；允许引用教材原文，重点是完整准确；vocabularyBank 要尽可能完整；像第 04 页的 Guided Conversation 和 Numbers 1-12 必须分别进入 contentInventory；所有字段必须完整；忽略手写批注、圈画、箭头、勾叉、铅笔涂改、课堂补充和非印刷体标记，不要把这些内容写入结果。

OCR 文本如下：
${ocrText}`,
  },
]

const parseContent = (payload) => {
  if (typeof payload === 'string') {
    return payload
  }

  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (item?.text) {
          return item.text
        }

        return ''
      })
      .join('\n')
  }

  return ''
}

const ensureApiKey = (setting) => {
  if (!setting.apiKey) {
    throw new Error('通义 API Key 未配置')
  }
}

const getCompatibleEndpoint = (setting, path = '/compatible-mode/v1/chat/completions') => {
  const endpoint = setting.endpoint || ''
  if (endpoint) {
    if (endpoint.includes('/compatible-mode/v1/')) {
      return endpoint.replace(/\/compatible-mode\/v1\/.+$/, path)
    }

    if (/^https?:\/\//i.test(endpoint)) {
      return `${endpoint.replace(/\/$/, '')}${path}`
    }
  }

  return `${setting.baseUrl || 'https://dashscope.aliyuncs.com'}${path}`
}

const getNativeEndpoint = (setting) =>
  setting.endpoint || `${setting.baseUrl || 'https://dashscope.aliyuncs.com'}/api/v1/services/aigc/text-generation/generation`

export const generateWithQwen = async ({ setting, ocrText, subjectName }) => {
  ensureApiKey(setting)

  const apiMode = setting.apiMode || 'native'
  if (apiMode === 'compatible') {
    const response = await fetch(getCompatibleEndpoint(setting), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${setting.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: setting.model || 'qwen-plus',
        messages: buildMessages(ocrText, subjectName),
        temperature: setting.temperature ?? 0.2,
        max_tokens: setting.maxOutputTokens || 2048,
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.message || '千问兼容模式调用失败')
    }

    return {
      content: parseContent(data?.choices?.[0]?.message?.content),
      usage: {
        inputTokens: data?.usage?.prompt_tokens || 0,
        outputTokens: data?.usage?.completion_tokens || 0,
        totalTokens: data?.usage?.total_tokens || 0,
      },
      raw: data,
    }
  }

  const response = await fetch(getNativeEndpoint(setting), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${setting.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: setting.model || 'qwen-plus',
      input: {
        messages: buildMessages(ocrText, subjectName),
      },
      parameters: {
        result_format: 'message',
        temperature: setting.temperature ?? 0.2,
        max_tokens: setting.maxOutputTokens || 2048,
      },
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.message || data?.code || '千问原生接口调用失败')
  }

  const messageContent =
    data?.output?.choices?.[0]?.message?.content ||
    data?.output?.text ||
    data?.output?.choices?.[0]?.text ||
    ''

  return {
    content: parseContent(messageContent),
    usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
      totalTokens: data?.usage?.total_tokens || 0,
    },
    raw: data,
  }
}

const normalizeAudioMimeType = (mimeType = 'audio/webm') => {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return 'audio/mpeg'
  }
  if (mimeType.includes('wav')) {
    return 'audio/wav'
  }
  if (mimeType.includes('ogg') || mimeType.includes('opus')) {
    return 'audio/ogg'
  }
  if (mimeType.includes('aac') || mimeType.includes('mp4') || mimeType.includes('m4a')) {
    return 'audio/mp4'
  }
  if (mimeType.includes('flac')) {
    return 'audio/flac'
  }

  return 'audio/webm'
}

const buildAudioDataUri = (audioBuffer, mimeType) =>
  `data:${normalizeAudioMimeType(mimeType)};base64,${audioBuffer.toString('base64')}`

const getProviderErrorMessage = (data, fallbackMessage) =>
  data?.error?.message || data?.message || data?.code || fallbackMessage

export const transcribeWithQwen = async ({ setting, audioBuffer, mimeType }) => {
  ensureApiKey(setting)

  const response = await fetch(getCompatibleEndpoint(setting), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${setting.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: setting.speechModel || 'qwen3-asr-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: buildAudioDataUri(audioBuffer, mimeType),
              },
            },
          ],
        },
      ],
      stream: false,
      extra_body: {
        asr_options: {
          enable_itn: false,
        },
      },
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(getProviderErrorMessage(data, '通义语音转写调用失败'))
  }

  const text = parseContent(data?.choices?.[0]?.message?.content).trim()

  return {
    text,
    usage: {
      inputTokens: data?.usage?.prompt_tokens || 0,
      outputTokens: data?.usage?.completion_tokens || 0,
      totalTokens: data?.usage?.total_tokens || 0,
      seconds: 0,
    },
    raw: data,
  }
}

const normalizeSpeechFormat = (format = '') => {
  const normalized = String(format).trim().toLowerCase()
  if (normalized === 'mp3') {
    return 'mp3'
  }

  return 'wav'
}

const detectAudioMimeType = (format = '') => {
  if (format === 'mp3') {
    return 'audio/mpeg'
  }

  return 'audio/wav'
}

const readAudioBufferFromUrl = async (url) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载阿里语音文件失败：${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

export const synthesizeWithQwen = async ({ setting, text }) => {
  ensureApiKey(setting)

  const format = normalizeSpeechFormat(setting.ttsFormat)
  const response = await fetch(getCompatibleEndpoint(setting, '/compatible-mode/v1/audio/speech'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${setting.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: setting.ttsModel || 'qwen3-tts-flash',
      input: text,
      voice: setting.ttsVoice || 'Cherry',
      response_format: format,
      language_type: setting.ttsLanguageType || 'English',
      instructions: setting.ttsInstructions || undefined,
    }),
  })

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getProviderErrorMessage(data, '通义语音合成调用失败'))
    }

    const audioUrl =
      data?.audio?.url ||
      data?.data?.[0]?.url ||
      data?.output?.audio?.url ||
      data?.output_audio?.url ||
      ''
    if (!audioUrl) {
      throw new Error('通义语音合成返回中缺少音频地址')
    }

    return {
      audioBuffer: await readAudioBufferFromUrl(audioUrl),
      mimeType: detectAudioMimeType(format),
      extension: format,
      usage: {
        inputTokens: Number(data?.usage?.input_tokens || 0),
        inputChars: Number(data?.usage?.characters || text.length || 0),
        outputTokens: Number(data?.usage?.output_tokens || 0),
        totalTokens: Number(data?.usage?.total_tokens || 0),
        requestCount: 1,
      },
      raw: data,
    }
  }

  if (!response.ok) {
    throw new Error(`通义语音合成调用失败：${response.status}`)
  }

  return {
    audioBuffer: Buffer.from(await response.arrayBuffer()),
    mimeType: detectAudioMimeType(format),
    extension: format,
    usage: {
      inputTokens: 0,
      inputChars: text.length || 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 1,
    },
    raw: null,
  }
}
