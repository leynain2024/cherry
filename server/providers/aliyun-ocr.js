import { Readable } from 'node:stream'
import OcrClient, { RecognizeAllTextRequest } from '@alicloud/ocr-api20210707'
import OpenApiClient from '@alicloud/openapi-client'

const normalizeBlocks = (data) => {
  const subImages = data?.subImages || []
  return subImages
    .flatMap((item) => {
      const paragraphs = item?.paragraphInfo?.paragraphDetails?.map((detail) => detail.paragraphContent) || []
      const blocks = item?.blockInfo?.blockDetails?.map((detail) => detail.blockContent) || []
      return [...paragraphs, ...blocks]
    })
    .filter(Boolean)
}

export const runAliyunOcr = async ({ setting, imageBuffer }) => {
  if (!setting.accessKeyId || !setting.accessKeySecret) {
    throw new Error('阿里云 OCR AccessKey 未配置')
  }

  const config = new OpenApiClient.Config({
    accessKeyId: setting.accessKeyId,
    accessKeySecret: setting.accessKeySecret,
    endpoint: setting.endpoint || 'ocr-api.cn-hangzhou.aliyuncs.com',
    regionId: setting.regionId || 'cn-hangzhou',
  })

  const client = new OcrClient(config)
  const request = new RecognizeAllTextRequest({
    type: setting.ocrType || 'Advanced',
    body: Readable.from(imageBuffer),
  })

  const response = await client.recognizeAllText(request)
  const text = normalizeBlocks(response?.body?.data).join('\n')

  return {
    text,
    raw: response?.body || null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 1,
    },
  }
}
