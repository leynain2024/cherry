import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDataStore } from './db.js'

const tempDirs = []

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

describe('data store', () => {
  it('preserves an explicit openai proxy and still allows direct connection when cleared', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-db-'))
    tempDirs.push(rootDir)
    const store = createDataStore({ rootDir })

    store.saveProviderSetting('openai', {
      apiMode: 'responses',
      model: 'gpt-5.2',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      endpoint: '',
      reasoningEffort: 'high',
      temperature: 0,
      maxOutputTokens: 2048,
      extra: {
        verbosity: 'medium',
        speechModel: 'gpt-4o-mini-transcribe',
        ttsModel: 'gpt-4o-mini-tts',
        ttsVoice: 'alloy',
        ttsFormat: 'mp3',
        ttsInstructions: '',
        ocrModel: 'gpt-5.2',
        proxyUrl: '127.0.0.1:7892',
      },
      pricing: {},
    })

    expect(store.getProviderSetting('openai')?.proxyUrl).toBe('127.0.0.1:7892')

    store.saveProviderSetting('openai', {
      apiMode: 'responses',
      model: 'gpt-5.2',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      endpoint: '',
      reasoningEffort: 'high',
      temperature: 0,
      maxOutputTokens: 2048,
      extra: {
        verbosity: 'medium',
        speechModel: 'gpt-4o-mini-transcribe',
        ttsModel: 'gpt-4o-mini-tts',
        ttsVoice: 'alloy',
        ttsFormat: 'mp3',
        ttsInstructions: '',
        ocrModel: 'gpt-5.2',
        proxyUrl: '',
      },
      pricing: {},
    })

    expect(store.getProviderSetting('openai')?.proxyUrl).toBe('')
  })
})
