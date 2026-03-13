const buildMessages = (ocrText, subjectName) => [
  {
    role: 'system',
    content:
      '你是小学英语课程整理助手。请把 OCR 文本整理成适合儿童网站使用的结构化单元草稿，只输出 JSON。',
  },
  {
    role: 'user',
    content: `请为学科“${subjectName}”生成一个网站单元草稿，字段要求如下：
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

要求：保留教材范围，但不要逐字复用教材原文；字段必须完整；词汇至少 4 个；句型至少 2 个；挑战题至少 2 题。

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

const getCompatibleEndpoint = (setting, path = '/compatible-mode/v1/chat/completions') =>
  setting.endpoint || `${setting.baseUrl || 'https://dashscope.aliyuncs.com'}${path}`

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
