// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeWithQwen } from './qwen-provider.js'

describe('transcribeWithQwen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends audio as a data url in compatible mode', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Hello my name is Amy.',
            },
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 6,
          total_tokens: 18,
        },
      }),
    })

    const result = await transcribeWithQwen({
      setting: {
        apiKey: 'test-key',
        baseUrl: 'https://dashscope.aliyuncs.com',
        speechModel: 'qwen3-asr-flash',
      },
      audioBuffer: Buffer.from('hello'),
      mimeType: 'audio/mp4',
    })

    expect(result.text).toBe('Hello my name is Amy.')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, requestInit] = fetchMock.mock.calls[0]
    const payload = JSON.parse(requestInit.body)

    expect(payload.model).toBe('qwen3-asr-flash')
    expect(payload.stream).toBe(false)
    expect(payload.extra_body).toEqual({
      asr_options: {
        enable_itn: false,
      },
    })
    expect(payload.messages).toHaveLength(1)
    expect(payload.messages[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: {
        data: `data:audio/mp4;base64,${Buffer.from('hello').toString('base64')}`,
      },
    })
  })

  it('surfaces dashscope error details when transcription fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          message: 'InternalError.Algo.InvalidParameter',
        },
      }),
    })

    await expect(
      transcribeWithQwen({
        setting: {
          apiKey: 'test-key',
          baseUrl: 'https://dashscope.aliyuncs.com',
          speechModel: 'qwen3-asr-flash',
        },
        audioBuffer: Buffer.from('hello'),
        mimeType: 'audio/webm',
      }),
    ).rejects.toThrow('InternalError.Algo.InvalidParameter')
  })
})
