// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'

const tempDirs = []

const makeApp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-'))
  tempDirs.push(dir)
  return createApp({ rootDir: dir })
}

const bootstrapAdminAndUser = async (app) => {
  await request(app).post('/api/admin/bootstrap').send({
    username: 'admin',
    password: 'secret123',
  })

  const adminLogin = await request(app).post('/api/admin/login').send({
    username: 'admin',
    password: 'secret123',
  })
  const adminCookie = adminLogin.headers['set-cookie'][0]
  const adminState = await request(app).get('/api/admin/state').set('Cookie', adminCookie)
  const subjectId = adminState.body.subjects[0].id

  const createdUser = await request(app).post('/api/admin/users').set('Cookie', adminCookie).send({
    username: 'amy',
    displayName: 'Amy',
    password: 'secret123',
    subjectId,
  })

  const userLogin = await request(app).post('/api/user/login').send({
    username: 'amy',
    password: 'secret123',
  })

  return {
    adminCookie,
    userCookie: userLogin.headers['set-cookie'][0],
    userId: createdUser.body.id,
    subjectId,
  }
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }))
})

const waitForGenerationJob = async (app, adminCookie, jobId) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request(app).get(`/api/generation-jobs/${jobId}`).set('Cookie', adminCookie)
    if (response.body.status === 'success' || response.body.status === 'failed') {
      return response
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error(`generation job ${jobId} did not finish in time`)
}

describe('server app', () => {
  it('preserves the selected image order when generating a draft', async () => {
    const seenImageFileNames = []
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-order-'))
    tempDirs.push(dir)
    const app = createApp({
      rootDir: dir,
      services: {
        runOcrForImages: async ({ imageRecords }) => {
          seenImageFileNames.push(...imageRecords.map((image) => image.fileName))
          return 'OCR text'
        },
        runDraftGeneration: async ({ subjectId, sourceImageIds }) => ({
          id: 'draft-order',
          subjectId,
          title: 'Draft Order',
          source: '教材图片整理',
          stage: 'Stage',
          goal: 'Goal',
          difficulty: 'Starter',
          unlockOrder: 1,
          coverEmoji: '📘',
          themeColor: '#48a8f6',
          status: 'draft',
          contentOrigin: 'imported',
          sourceImageIds,
          rewardRule: {
            starsPerComplete: 2,
            starsPerPerfect: 3,
            unlockAtStars: 8,
            reviewTriggerMistakes: 2,
          },
          vocabulary: [],
          patterns: [],
          reading: {
            id: 'reading-1',
            title: 'Reading',
            content: '',
            audioText: '',
            question: '',
          },
          activities: [],
        }),
      },
    })
    const { adminCookie, subjectId } = await bootstrapAdminAndUser(app)

    const upload = await request(app)
      .post(`/api/subjects/${subjectId}/images`)
      .set('Cookie', adminCookie)
      .attach('images', Buffer.from('a'), { filename: 'page-10.png', contentType: 'image/png' })
      .attach('images', Buffer.from('b'), { filename: 'page-2.png', contentType: 'image/png' })

    expect(upload.statusCode).toBe(201)

    const selectedImageIds = [upload.body[1].id, upload.body[0].id]
    const generate = await request(app)
      .post(`/api/subjects/${subjectId}/generate-unit-draft`)
      .set('Cookie', adminCookie)
      .send({ imageIds: selectedImageIds })

    expect(generate.statusCode).toBe(202)
    const finishedJob = await waitForGenerationJob(app, adminCookie, generate.body.id)
    expect(seenImageFileNames).toEqual(['page-2.png', 'page-10.png'])
    expect(finishedJob.body.imageIds).toEqual(selectedImageIds)
    expect(finishedJob.body.draftUnitId).toBe('draft-order')
  })

  it('stores generated drafts under the requested subject even if a service returns a mismatched subject id', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-subject-'))
    tempDirs.push(dir)
    const app = createApp({
      rootDir: dir,
      services: {
        runOcrForImages: async () => 'OCR text',
        runDraftGeneration: async ({ sourceImageIds }) => ({
          id: 'draft-subject-guard',
          subjectId: 'subject-haibao-experience',
          title: 'Draft Subject Guard',
          source: '教材图片整理',
          stage: 'Stage',
          goal: 'Goal',
          difficulty: 'Starter',
          unlockOrder: 1,
          coverEmoji: '📘',
          themeColor: '#48a8f6',
          status: 'draft',
          contentOrigin: 'imported',
          sourceImageIds,
          rewardRule: {
            starsPerComplete: 2,
            starsPerPerfect: 3,
            unlockAtStars: 8,
            reviewTriggerMistakes: 2,
          },
          vocabulary: [],
          patterns: [],
          reading: {
            id: 'reading-guard',
            title: 'Reading',
            content: '',
            audioText: '',
            question: '',
          },
          activities: [],
        }),
      },
    })

    const { adminCookie } = await bootstrapAdminAndUser(app)

    const newSubject = await request(app).post('/api/subjects').set('Cookie', adminCookie).send({
      name: '新概念英语',
      description: '测试学科',
    })
    expect(newSubject.statusCode).toBe(201)

    const upload = await request(app)
      .post(`/api/subjects/${newSubject.body.id}/images`)
      .set('Cookie', adminCookie)
      .attach('images', Buffer.from('a'), { filename: 'page-1.png', contentType: 'image/png' })
    expect(upload.statusCode).toBe(201)

    const generate = await request(app)
      .post(`/api/subjects/${newSubject.body.id}/generate-unit-draft`)
      .set('Cookie', adminCookie)
      .send({ imageIds: [upload.body[0].id] })
    expect(generate.statusCode).toBe(202)

    const finishedJob = await waitForGenerationJob(app, adminCookie, generate.body.id)
    expect(finishedJob.body.status).toBe('success')

    const adminState = await request(app).get('/api/admin/state').set('Cookie', adminCookie)
    const generatedDraft = adminState.body.drafts.find((draft) => draft.id === 'draft-subject-guard')
    expect(generatedDraft.subjectId).toBe(newSubject.body.id)
  })

  it('generates lesson audio before publishing a draft', async () => {
    const generatedAudioPayloads = []
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-tts-'))
    tempDirs.push(dir)
    const app = createApp({
      rootDir: dir,
      services: {
        runOcrForImages: async () => 'OCR text',
        runDraftGeneration: async ({ subjectId, sourceImageIds }) => ({
          id: 'draft-tts',
          subjectId,
          title: 'Draft TTS',
          source: '教材图片整理',
          stage: 'Stage',
          goal: 'Goal',
          difficulty: 'Starter',
          unlockOrder: 1,
          coverEmoji: '📘',
          themeColor: '#48a8f6',
          status: 'draft',
          contentOrigin: 'imported',
          sourceImageIds,
          rewardRule: {
            starsPerComplete: 2,
            starsPerPerfect: 3,
            unlockAtStars: 8,
            reviewTriggerMistakes: 2,
          },
          vocabulary: [],
          patterns: [],
          reading: {
            id: 'reading-1',
            title: 'Reading',
            content: '',
            audioText: '',
            question: '',
          },
          activities: [
            {
              id: 'listen-1',
              title: '听音选意思',
              prompt: '听一听',
              skill: 'listen',
              kind: 'listen-choice',
              durationMinutes: 2,
              audioText: 'Hello class',
              question: 'What did you hear?',
              options: [{ id: 'a', label: 'Hello', emoji: '⭐' }],
              correctOptionId: 'a',
            },
          ],
        }),
        generateUnitAudioAssets: async ({ unit, activeAiVendor }) => {
          generatedAudioPayloads.push({ unitId: unit.id, activeAiVendor })
          return {
            ...unit,
            activities: unit.activities.map((activity) =>
              activity.kind === 'listen-choice'
                ? {
                    ...activity,
                    audioUrl: '/audio-assets/draft-tts-listen-1.mp3',
                    audioMimeType: 'audio/mpeg',
                  }
                : activity,
            ),
          }
        },
      },
    })
    const { adminCookie, subjectId } = await bootstrapAdminAndUser(app)

    const upload = await request(app)
      .post(`/api/subjects/${subjectId}/images`)
      .set('Cookie', adminCookie)
      .attach('images', Buffer.from('a'), { filename: 'page-1.png', contentType: 'image/png' })
    expect(upload.statusCode).toBe(201)

    const generate = await request(app)
      .post(`/api/subjects/${subjectId}/generate-unit-draft`)
      .set('Cookie', adminCookie)
      .send({ imageIds: [upload.body[0].id] })
    expect(generate.statusCode).toBe(202)

    const finishedJob = await waitForGenerationJob(app, adminCookie, generate.body.id)
    expect(finishedJob.body.status).toBe('success')

    const publish = await request(app).post('/api/drafts/draft-tts/publish').set('Cookie', adminCookie)
    expect(publish.statusCode).toBe(200)
    expect(generatedAudioPayloads).toEqual([{ unitId: 'draft-tts', activeAiVendor: 'openai' }])
    expect(publish.body.status).toBe('published')
    expect(publish.body.activities[0].audioUrl).toBe('/audio-assets/draft-tts-listen-1.mp3')
  })

  it('retries draft generation with cached ocr text without rerunning ocr', async () => {
    let ocrCallCount = 0
    let draftCallCount = 0
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-retry-'))
    tempDirs.push(dir)
    const app = createApp({
      rootDir: dir,
      services: {
        runOcrForImages: async () => {
          ocrCallCount += 1
          return 'OCR text from cache'
        },
        runDraftGeneration: async ({ subjectId, sourceImageIds }) => {
          draftCallCount += 1
          if (draftCallCount === 1) {
            throw new Error('Expected \',\' or \'}\' after property value in JSON at position 12')
          }

          return {
            id: 'draft-retry',
            subjectId,
            title: 'Draft Retry',
            source: '教材图片整理',
            stage: 'Stage',
            goal: 'Goal',
            difficulty: 'Starter',
            unlockOrder: 1,
            coverEmoji: '📘',
            themeColor: '#48a8f6',
            status: 'draft',
            contentOrigin: 'imported',
            sourceImageIds,
            rewardRule: {
              starsPerComplete: 2,
              starsPerPerfect: 3,
              unlockAtStars: 8,
              reviewTriggerMistakes: 2,
            },
            vocabulary: [],
            patterns: [],
            reading: {
              id: 'reading-retry',
              title: 'Reading',
              content: '',
              audioText: '',
              question: '',
            },
            activities: [],
          }
        },
      },
    })

    const { adminCookie, subjectId } = await bootstrapAdminAndUser(app)

    const upload = await request(app)
      .post(`/api/subjects/${subjectId}/images`)
      .set('Cookie', adminCookie)
      .attach('images', Buffer.from('a'), { filename: 'page-1.png', contentType: 'image/png' })
    expect(upload.statusCode).toBe(201)

    const generate = await request(app)
      .post(`/api/subjects/${subjectId}/generate-unit-draft`)
      .set('Cookie', adminCookie)
      .send({ imageIds: [upload.body[0].id] })
    expect(generate.statusCode).toBe(202)

    const failedJob = await waitForGenerationJob(app, adminCookie, generate.body.id)
    expect(failedJob.body.status).toBe('failed')
    expect(failedJob.body.hasOcrText).toBe(true)
    expect(ocrCallCount).toBe(1)
    expect(draftCallCount).toBe(1)

    const retry = await request(app).post(`/api/generation-jobs/${failedJob.body.id}/retry-draft`).set('Cookie', adminCookie)
    expect(retry.statusCode).toBe(202)

    const retriedJob = await waitForGenerationJob(app, adminCookie, retry.body.id)
    expect(retriedJob.body.status).toBe('success')
    expect(retriedJob.body.draftUnitId).toBe('draft-retry')
    expect(ocrCallCount).toBe(1)
    expect(draftCallCount).toBe(2)
  })

  it('retries from cached model output without calling the draft model again', async () => {
    let draftCallCount = 0
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-retry-cached-response-'))
    tempDirs.push(dir)
    const app = createApp({
      rootDir: dir,
      services: {
        runOcrForImages: async () => 'OCR text from cache',
        runDraftGeneration: async ({ onModelResponse }) => {
          draftCallCount += 1
          await onModelResponse?.({
            content: JSON.stringify({
              title: 'Cached Draft',
              stage: 'Stage',
              goal: 'Goal',
              difficulty: 'Starter',
              coverEmoji: '📘',
              themeColor: '#48a8f6',
              vocabularyBank: [],
              patterns: [],
              contentInventory: [],
            }),
            usage: {
              inputTokens: 100,
              outputTokens: 120,
              totalTokens: 220,
            },
          })
          throw new Error('模型未返回可解析 JSON')
        },
      },
    })

    const { adminCookie, subjectId } = await bootstrapAdminAndUser(app)

    const upload = await request(app)
      .post(`/api/subjects/${subjectId}/images`)
      .set('Cookie', adminCookie)
      .attach('images', Buffer.from('a'), { filename: 'page-1.png', contentType: 'image/png' })
    expect(upload.statusCode).toBe(201)

    const generate = await request(app)
      .post(`/api/subjects/${subjectId}/generate-unit-draft`)
      .set('Cookie', adminCookie)
      .send({ imageIds: [upload.body[0].id] })
    expect(generate.statusCode).toBe(202)

    const failedJob = await waitForGenerationJob(app, adminCookie, generate.body.id)
    expect(failedJob.body.status).toBe('failed')
    expect(failedJob.body.hasDraftResponse).toBe(true)
    expect(draftCallCount).toBe(1)

    const retry = await request(app).post(`/api/generation-jobs/${failedJob.body.id}/retry-draft`).set('Cookie', adminCookie)
    expect(retry.statusCode).toBe(202)

    const retriedJob = await waitForGenerationJob(app, adminCookie, retry.body.id)
    expect(retriedJob.body.status).toBe('success')
    expect(retriedJob.body.hasDraftResponse).toBe(true)
    expect(retriedJob.body.hasParsedPayload).toBe(true)
    expect(retriedJob.body.draftUnitId).toBeTruthy()
    expect(draftCallCount).toBe(1)
  })

  it('requires a user session for app data', async () => {
    const app = makeApp()
    const response = await request(app).get('/api/app-data')

    expect(response.statusCode).toBe(401)
    expect(response.body.error).toContain('登录')
  })

  it('supports bootstrap, admin login and user management', async () => {
    const app = makeApp()
    const { adminCookie } = await bootstrapAdminAndUser(app)

    const state = await request(app).get('/api/admin/state').set('Cookie', adminCookie)
    expect(state.statusCode).toBe(200)
    expect(state.body.users).toHaveLength(1)
    expect(state.body.users[0].username).toBe('amy')
  })

  it('returns a field-level duplicate username error for create and update', async () => {
    const app = makeApp()
    const { adminCookie, subjectId } = await bootstrapAdminAndUser(app)

    const duplicateCreate = await request(app).post('/api/admin/users').set('Cookie', adminCookie).send({
      username: 'amy',
      displayName: 'Amy Again',
      password: 'secret123',
      subjectId,
    })
    expect(duplicateCreate.statusCode).toBe(409)
    expect(duplicateCreate.body.code).toBe('duplicate_username')
    expect(duplicateCreate.body.field).toBe('username')

    const createdUser = await request(app).post('/api/admin/users').set('Cookie', adminCookie).send({
      username: 'ben',
      displayName: 'Ben',
      password: 'secret123',
      subjectId,
    })
    expect(createdUser.statusCode).toBe(201)

    const duplicateUpdate = await request(app)
      .patch(`/api/admin/users/${createdUser.body.id}`)
      .set('Cookie', adminCookie)
      .send({
        username: 'amy',
        displayName: 'Ben',
        enabled: true,
      })
    expect(duplicateUpdate.statusCode).toBe(409)
    expect(duplicateUpdate.body.code).toBe('duplicate_username')
    expect(duplicateUpdate.body.field).toBe('username')
  })

  it('returns app data for an authenticated user', async () => {
    const app = makeApp()
    const { userCookie } = await bootstrapAdminAndUser(app)

    const response = await request(app).get('/api/app-data').set('Cookie', userCookie)

    expect(response.statusCode).toBe(200)
    expect(response.body.subjects[0].name).toBe('海宝体验课')
    expect(response.body.currentUser.username).toBe('amy')
    expect(response.body.progress.childName).toBe('Amy')
  })

  it('persists user progress on the server', async () => {
    const app = makeApp()
    const { userCookie } = await bootstrapAdminAndUser(app)
    const appData = await request(app).get('/api/app-data').set('Cookie', userCookie)
    const unit = appData.body.units[0]
    const activity = unit.activities[0]

    const payload = {
      childName: 'Amy',
      currentUnitId: unit.id,
      totalStars: 3,
      streakDays: 2,
      lastActiveDate: '2026-03-13',
      completedUnitIds: [unit.id],
      activityResults: {
        [`${unit.id}:${activity.id}`]: {
          unitId: unit.id,
          activityId: activity.id,
          completed: true,
          score: 100,
          durationSeconds: 30,
          mistakes: [],
          completedAt: new Date().toISOString(),
        },
      },
      weakPoints: [],
    }

    const save = await request(app).post('/api/user/progress').set('Cookie', userCookie).send(payload)
    expect(save.statusCode).toBe(200)
    expect(save.body.totalStars).toBe(3)

    const load = await request(app).get('/api/user/progress').set('Cookie', userCookie)
    expect(load.statusCode).toBe(200)
    expect(load.body.activityResults[`${unit.id}:${activity.id}`].score).toBe(100)
  })

  it('uploads, evaluates and lists speaking recordings for the current user', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibao-speaking-'))
    tempDirs.push(dir)
    const app = createApp({
      rootDir: dir,
      services: {
        evaluateSpeakingSubmission: async ({ targetTranscript }) => ({
          transcript: 'hello world',
          normalizedTranscript: 'hello world',
          normalizedTarget: targetTranscript.toLowerCase(),
          score: 96,
          passed: true,
          feedback: '很好',
          mistakes: [],
        }),
      },
    })

    const { userCookie } = await bootstrapAdminAndUser(app)

    const upload = await request(app)
      .post('/api/speaking/recordings')
      .set('Cookie', userCookie)
      .field('unitId', 'u1')
      .field('activityId', 'a1')
      .field('durationSeconds', '4')
      .attach('audio', Buffer.from('demo'), { filename: 'speaking.webm', contentType: 'audio/webm' })

    expect(upload.statusCode).toBe(201)
    expect(upload.body.audioUrl).toContain('/api/speaking/recordings/')

    const evaluate = await request(app)
      .post('/api/speaking/evaluate')
      .set('Cookie', userCookie)
      .send({
        recordingId: upload.body.id,
        transcript: 'Hello world',
      })

    expect(evaluate.statusCode).toBe(200)
    expect(evaluate.body.score).toBe(96)
    expect(evaluate.body.recordingId).toBe(upload.body.id)

    const list = await request(app).get('/api/speaking/recordings?unitId=u1&activityId=a1').set('Cookie', userCookie)
    expect(list.statusCode).toBe(200)
    expect(list.body[0].score).toBe(96)
    expect(list.body[0].submittedAt).toBeTruthy()
  })

  it('forces a logged-in user to log in again after the admin changes the assigned subject', async () => {
    const app = makeApp()
    const { adminCookie, userCookie, userId } = await bootstrapAdminAndUser(app)

    const newSubject = await request(app).post('/api/subjects').set('Cookie', adminCookie).send({
      name: '自然拼读',
      description: '第二学科',
    })
    expect(newSubject.statusCode).toBe(201)

    const assign = await request(app)
      .post(`/api/admin/users/${userId}/subject`)
      .set('Cookie', adminCookie)
      .send({ subjectId: newSubject.body.id })
    expect(assign.statusCode).toBe(200)
    expect(assign.body.user.subjectId).toBe(newSubject.body.id)
    expect(assign.body.forcedLogout).toBe(true)

    const session = await request(app).get('/api/user/session').set('Cookie', userCookie)
    expect(session.statusCode).toBe(200)
    expect(session.body.authenticated).toBe(false)

    const appData = await request(app).get('/api/app-data').set('Cookie', userCookie)
    expect(appData.statusCode).toBe(401)
  })
})
