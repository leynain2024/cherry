import { describe, expect, it } from 'vitest'
import { estimateUsageCost, getCapabilityPricing } from './pricing.js'

describe('pricing', () => {
  it('estimates qwen speech cost by audio duration', () => {
    const pricing = getCapabilityPricing('qwen', 'speech')

    expect(pricing.perMinute).toBe(0.0132)
    expect(estimateUsageCost(pricing, { seconds: 30 })).toBe(0.0066)
  })

  it('estimates qwen tts cost by input characters', () => {
    const pricing = getCapabilityPricing('qwen', 'tts')

    expect(pricing.inputPerTenThousandChars).toBe(0.8)
    expect(estimateUsageCost(pricing, { inputChars: 600 })).toBe(0.048)
  })
})
