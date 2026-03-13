const numberOrNull = (value) => {
  if (value === '' || value == null) {
    return null
  }

  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

export const defaultPricingSnapshots = {
  openai: {
    text: {
      inputPerMillion: 1.25,
      outputPerMillion: 10,
    },
    speech: {
      inputPerMillion: 1.25,
      outputPerMillion: 0,
    },
    ocr: {
      inputPerMillion: 1.25,
      outputPerMillion: 10,
    },
  },
  qwen: {
    text: {},
    speech: {},
  },
  'aliyun-ocr': {
    ocr: {
      requestCost: 0.0825,
    },
  },
}

const normalizeValues = (raw = {}) => ({
  inputPerMillion: numberOrNull(raw.inputPerMillion),
  outputPerMillion: numberOrNull(raw.outputPerMillion),
  requestCost: numberOrNull(raw.requestCost),
  perMinute: numberOrNull(raw.perMinute),
})

export const normalizePricing = (raw = {}) => {
  if ('inputPerMillion' in raw || 'outputPerMillion' in raw || 'requestCost' in raw || 'perMinute' in raw) {
    return {
      text: normalizeValues(raw),
    }
  }

  return {
    text: normalizeValues(raw.text),
    speech: normalizeValues(raw.speech),
    ocr: normalizeValues(raw.ocr),
  }
}

export const getCapabilityPricing = (provider, capability, overrides = {}) => {
  const snapshot = defaultPricingSnapshots[provider]?.[capability] || {}
  const normalizedOverrides = normalizePricing(overrides)?.[capability] || {}
  const merged = {
    inputPerMillion:
      normalizedOverrides.inputPerMillion != null ? normalizedOverrides.inputPerMillion : numberOrNull(snapshot.inputPerMillion),
    outputPerMillion:
      normalizedOverrides.outputPerMillion != null
        ? normalizedOverrides.outputPerMillion
        : numberOrNull(snapshot.outputPerMillion),
    requestCost:
      normalizedOverrides.requestCost != null ? normalizedOverrides.requestCost : numberOrNull(snapshot.requestCost),
    perMinute: normalizedOverrides.perMinute != null ? normalizedOverrides.perMinute : numberOrNull(snapshot.perMinute),
  }

  return merged
}

export const estimateUsageCost = (pricing, usage = {}) => {
  const inputTokens = Number(usage.inputTokens || 0)
  const outputTokens = Number(usage.outputTokens || 0)
  const requestCount = Number(usage.requestCount || 0)
  const seconds = Number(usage.seconds || 0)

  const estimatedCost =
    (inputTokens / 1_000_000) * Number(pricing.inputPerMillion || 0) +
    (outputTokens / 1_000_000) * Number(pricing.outputPerMillion || 0) +
    requestCount * Number(pricing.requestCost || 0) +
    (seconds / 60) * Number(pricing.perMinute || 0)

  if (!estimatedCost && !pricing.inputPerMillion && !pricing.outputPerMillion && !pricing.requestCost && !pricing.perMinute) {
    return null
  }

  return Number(estimatedCost.toFixed(6))
}
