import { describe, expect, it } from 'vitest'
import { parseJsonContent } from './generation.js'

describe('generation parsing', () => {
  it('parses valid json inside markdown fences', () => {
    const parsed = parseJsonContent(`
\`\`\`json
{"title":"Unit 1","activities":{"listen":{"title":"Listen"}}}
\`\`\`
`)

    expect(parsed.title).toBe('Unit 1')
    expect(parsed.activities.listen.title).toBe('Listen')
  })

  it('repairs near-json output with a missing comma', () => {
    const parsed = parseJsonContent(`
{
  "title": "Unit 2",
  "reading": {
    "title": "Reading"
    "content": "Hello class."
  }
}
`)

    expect(parsed.title).toBe('Unit 2')
    expect(parsed.reading.content).toBe('Hello class.')
  })
})
