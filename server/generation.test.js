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

  it('extracts json when the model adds explanation text before and after the object', () => {
    const parsed = parseJsonContent(`
整理结果如下，请直接使用：

{
  "title": "Unit 3",
  "contentInventory": [
    {
      "title": "Numbers 1-12"
    }
  ]
}

上面就是最终 JSON。
`)

    expect(parsed.title).toBe('Unit 3')
    expect(parsed.contentInventory[0].title).toBe('Numbers 1-12')
  })

  it('ignores unrelated brace text and uses the valid json object block', () => {
    const parsed = parseJsonContent(`
提示：字段格式示例 {title: "..."} 仅供参考。

\`\`\`json
{
  "title": "Unit 4",
  "vocabularyBank": [
    {
      "word": "hello"
    }
  ]
}
\`\`\`
`)

    expect(parsed.title).toBe('Unit 4')
    expect(parsed.vocabularyBank[0].word).toBe('hello')
  })
})
