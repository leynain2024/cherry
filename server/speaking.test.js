// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeAudioInput, scoreSpeakingTranscript } from './speaking.js'

describe('speaking audio normalization', () => {
  it('normalizes iphone-style mp4 uploads to m4a', () => {
    expect(normalizeAudioInput({ mimeType: 'audio/mp4', fileName: 'speaking.webm' })).toEqual({
      mimeType: 'audio/mp4',
      fileName: 'speaking.m4a',
    })
  })

  it('keeps webm uploads as webm', () => {
    expect(normalizeAudioInput({ mimeType: 'audio/webm;codecs=opus', fileName: 'speaking.webm' })).toEqual({
      mimeType: 'audio/webm',
      fileName: 'speaking.webm',
    })
  })

  it('scores near-miss transcripts more strictly', () => {
    const result = scoreSpeakingTranscript({
      targetTranscript: 'Hello my name is Amy',
      spokenTranscript: 'Hello my name Amy',
      passScore: 60,
    })

    expect(result.passed).toBe(false)
    expect(result.score).toBeLessThan(80)
  })

  it('honors the configured pass score when the transcript is otherwise complete', () => {
    const result = scoreSpeakingTranscript({
      targetTranscript: 'Hello my name is Amy',
      spokenTranscript: 'Hello my name is Amy',
      passScore: 75,
    })

    expect(result.passed).toBe(true)
    expect(result.score).toBe(100)
  })
})
