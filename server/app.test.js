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

describe('server app', () => {
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
