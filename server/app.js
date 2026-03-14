import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { parse, serialize } from 'cookie'
import { createDataStore } from './db.js'
import { buildDraftUnitFromModel, parseJsonContent, runDraftGeneration, runOcrForImages } from './generation.js'
import { evaluateSpeakingSubmission } from './speaking.js'
import { generateUnitAudioAssets } from './tts.js'

const SESSION_COOKIE = 'haibao_admin_session'
const USER_SESSION_COOKIE = 'haibao_user_session'

const createUploadStorage = (uploadsDir) =>
  multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^\w.-]+/g, '-')}`
      cb(null, safeName)
    },
  })

const readCookies = (req) => parse(req.headers.cookie || '')

const detectImageMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

const authMiddleware = (store) => (req, res, next) => {
  const cookies = readCookies(req)
  const session = store.getSession(cookies[SESSION_COOKIE])
  if (!session) {
    res.status(401).json({ error: '需要管理员登录' })
    return
  }

  req.adminSession = session
  next()
}

const userAuthMiddleware = (store) => (req, res, next) => {
  const cookies = readCookies(req)
  const session = store.getUserSession(cookies[USER_SESSION_COOKIE])
  if (!session) {
    res.status(401).json({ error: '需要先登录学习账号' })
    return
  }

  req.userSession = session
  next()
}

export const createApp = ({ rootDir = process.cwd(), services = {} } = {}) => {
  const store = createDataStore({ rootDir })
  const app = express()
  const upload = multer({ storage: createUploadStorage(store.uploadsDir) })
  const speakingUpload = multer({ storage: createUploadStorage(store.recordingsDir), limits: { fileSize: 12 * 1024 * 1024 } })
  const draftGenerationService = services.runDraftGeneration || runDraftGeneration
  const ocrService = services.runOcrForImages || runOcrForImages
  const speakingService = services.evaluateSpeakingSubmission || evaluateSpeakingSubmission
  const unitAudioService = services.generateUnitAudioAssets || generateUnitAudioAssets

  app.use(express.json({ limit: '5mb' }))
  app.use('/uploads', express.static(store.uploadsDir))
  app.use('/audio-assets', express.static(store.audioAssetsDir))

  app.get('/api/app-data', userAuthMiddleware(store), (req, res) => {
    res.json({
      bootstrapped: store.isBootstrapped(),
      ...store.getAppData(req.userSession.user.id),
    })
  })

  app.get('/api/user/session', (req, res) => {
    const session = store.getUserSession(readCookies(req)[USER_SESSION_COOKIE])
    res.json({
      authenticated: Boolean(session),
      user: session?.user ?? null,
    })
  })

  app.post('/api/user/login', (req, res) => {
    const { username, password } = req.body || {}
    const user = store.verifyUser(username?.trim(), password)
    if (!user) {
      res.status(401).json({ error: '学习账号或密码错误' })
      return
    }

    const session = store.createUserSession(user.id)
    res.setHeader(
      'Set-Cookie',
      serialize(USER_SESSION_COOKIE, session.token, {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
        maxAge: 14 * 24 * 60 * 60,
      }),
    )
    res.json({
      authenticated: true,
      user,
    })
  })

  app.post('/api/user/logout', (req, res) => {
    const cookies = readCookies(req)
    if (cookies[USER_SESSION_COOKIE]) {
      store.deleteUserSession(cookies[USER_SESSION_COOKIE])
    }

    res.setHeader(
      'Set-Cookie',
      serialize(USER_SESSION_COOKIE, '', {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
        maxAge: 0,
      }),
    )
    res.json({ ok: true })
  })

  app.get('/api/user/progress', userAuthMiddleware(store), (req, res) => {
    res.json(store.getUserProgress(req.userSession.user.id))
  })

  app.post('/api/user/progress', userAuthMiddleware(store), (req, res) => {
    res.json(store.saveUserProgress(req.userSession.user.id, req.body || {}))
  })

  app.get('/api/admin/session', (req, res) => {
    const session = store.getSession(readCookies(req)[SESSION_COOKIE])
    res.json({
      bootstrapped: store.isBootstrapped(),
      authenticated: Boolean(session),
      username: session?.username ?? null,
    })
  })

  app.post('/api/admin/bootstrap', (req, res) => {
    if (store.isBootstrapped()) {
      res.status(409).json({ error: '管理员已初始化' })
      return
    }

    const { username, password } = req.body || {}
    if (!username || !password) {
      res.status(400).json({ error: '请输入管理员账号和密码' })
      return
    }

    store.createAdminUser(username.trim(), password)
    res.status(201).json({ ok: true })
  })

  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {}
    const admin = store.verifyAdminUser(username?.trim(), password)
    if (!admin) {
      res.status(401).json({ error: '账号或密码错误' })
      return
    }

    const session = store.createSession(admin.id)
    res.setHeader(
      'Set-Cookie',
      serialize(SESSION_COOKIE, session.token, {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
        maxAge: 14 * 24 * 60 * 60,
      }),
    )
    res.json({ ok: true, username: admin.username })
  })

  app.post('/api/admin/logout', (req, res) => {
    const cookies = readCookies(req)
    if (cookies[SESSION_COOKIE]) {
      store.deleteSession(cookies[SESSION_COOKIE])
    }

    res.setHeader(
      'Set-Cookie',
      serialize(SESSION_COOKIE, '', {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
        maxAge: 0,
      }),
    )
    res.json({ ok: true })
  })

  app.post('/api/admin/password', authMiddleware(store), (req, res) => {
    const { currentPassword, newPassword } = req.body || {}
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: '请输入当前密码和新密码' })
      return
    }

    if (String(newPassword).length < 6) {
      res.status(400).json({ error: '新密码至少 6 位' })
      return
    }

    const changed = store.changeAdminPassword(req.adminSession.admin_id, currentPassword, newPassword)
    if (!changed) {
      res.status(400).json({ error: '当前密码不正确' })
      return
    }

    res.json({ ok: true })
  })

  app.get('/api/admin/state', authMiddleware(store), (_req, res) => {
    res.json(store.getAdminState())
  })

  app.post('/api/admin/users', authMiddleware(store), (req, res) => {
    const { username, displayName, password, subjectId } = req.body || {}
    if (!username?.trim() || !displayName?.trim() || !password || !subjectId?.trim()) {
      res.status(400).json({ error: '请输入登录名、姓名、密码和学科' })
      return
    }

    if (String(password).length < 6) {
      res.status(400).json({ error: '密码至少 6 位' })
      return
    }

    if (!store.getSubject(subjectId.trim())) {
      res.status(400).json({ error: '请选择有效学科' })
      return
    }

    try {
      const user = store.createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        subjectId: subjectId.trim(),
      })
      res.status(201).json(user)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        res.status(409).json({ error: '登录名已存在', code: 'duplicate_username', field: 'username' })
        return
      }
      throw error
    }
  })

  app.patch('/api/admin/users/:id', authMiddleware(store), (req, res) => {
    const { username, displayName, enabled } = req.body || {}
    if (!username?.trim() || !displayName?.trim()) {
      res.status(400).json({ error: '请输入登录名和姓名' })
      return
    }

    try {
      const user = store.updateUser(req.params.id, {
        username: username.trim(),
        displayName: displayName.trim(),
        enabled: Boolean(enabled),
      })
      if (!user) {
        res.status(404).json({ error: '用户不存在' })
        return
      }
      res.json(user)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        res.status(409).json({ error: '登录名已存在', code: 'duplicate_username', field: 'username' })
        return
      }
      throw error
    }
  })

  app.post('/api/admin/users/:id/password', authMiddleware(store), (req, res) => {
    const { newPassword } = req.body || {}
    if (!newPassword || String(newPassword).length < 6) {
      res.status(400).json({ error: '新密码至少 6 位' })
      return
    }

    const ok = store.resetUserPassword(req.params.id, newPassword)
    if (!ok) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    res.json({ ok: true })
  })

  app.post('/api/admin/users/:id/subject', authMiddleware(store), (req, res) => {
    const rawSubjectId = typeof req.body?.subjectId === 'string' ? req.body.subjectId.trim() : ''
    const subjectId = rawSubjectId || null
    if (subjectId && !store.getSubject(subjectId)) {
      res.status(400).json({ error: '学科不存在' })
      return
    }

    const result = store.assignUserSubject(req.params.id, subjectId)
    if (!result) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    res.json(result)
  })

  app.delete('/api/admin/users/:id', authMiddleware(store), (req, res) => {
    const ok = store.deleteUser(req.params.id)
    if (!ok) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    res.json({ ok: true })
  })

  app.get('/api/subjects', authMiddleware(store), (_req, res) => {
    res.json(store.getAdminState().subjects)
  })

  app.post('/api/subjects', authMiddleware(store), (req, res) => {
    const { name, description } = req.body || {}
    if (!name?.trim()) {
      res.status(400).json({ error: '学科名称不能为空' })
      return
    }

    const subject = store.createSubject({
      name: name.trim(),
      description: description?.trim() || '新的英语学科',
      themeColor: '#48a8f6',
    })
    res.status(201).json(subject)
  })

  app.post('/api/subjects/:id/images', authMiddleware(store), upload.array('images', 20), (req, res) => {
    const subject = store.getSubject(req.params.id)
    if (!subject) {
      res.status(404).json({ error: '学科不存在' })
      return
    }

    const files = req.files || []
    const images = files.map((file) =>
      store.addSubjectImage({
        subjectId: req.params.id,
        fileName: file.originalname,
        filePath: file.path,
      }),
    )

    res.status(201).json(images)
  })

  app.post('/api/subjects/:id/generate-unit-draft', authMiddleware(store), async (req, res) => {
    const { imageIds = [] } = req.body || {}
    const subject = store.getSubject(req.params.id)
    if (!subject) {
      res.status(404).json({ error: '学科不存在' })
      return
    }

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      res.status(400).json({ error: '请至少选择一张教材图片' })
      return
    }

    const images = store.getImagesByIds(req.params.id, imageIds)
    if (!images.length) {
      res.status(400).json({ error: '没有找到对应图片' })
      return
    }

    const projectSettings = store.getProjectSettings()
    const provider = projectSettings.activeAiVendor
    const providerSetting = store.getProviderSetting(provider === 'openai' ? 'openai' : 'qwen')
    const ocrSetting = store.getProviderSetting('aliyun-ocr')
    if (!providerSetting) {
      res.status(400).json({ error: '模型供应商配置不存在' })
      return
    }

    const job = store.createGenerationJob({
      subjectId: subject.id,
      imageIds,
      provider,
      model: providerSetting.model,
    })

    res.status(202).json(store.getGenerationJob(job.id))

    void (async () => {
      try {
        const imageRecords = images.map((image) => ({
          ...image,
          buffer: fs.readFileSync(image.filePath),
          mimeType: detectImageMimeType(image.filePath),
        }))

        store.updateGenerationJobProgress({
          jobId: job.id,
          stage: 'ocr',
          processedImages: 0,
          totalImages: imageRecords.length,
          message: `正在识别教材图片（0/${imageRecords.length}）`,
        })

        const ocrText = await ocrService({
          activeAiVendor: provider,
          openAiSetting: store.getProviderSetting('openai'),
          ocrSetting,
          imageRecords,
          insertUsageLog: (payload) => store.insertUsageLog(payload),
          subjectId: subject.id,
          jobId: job.id,
          onProgress: (progress) =>
            store.updateGenerationJobProgress({
              jobId: job.id,
              ...progress,
            }),
        })
        store.saveGenerationJobOcrText({
          jobId: job.id,
          ocrText,
        })

        const draftUnit = await draftGenerationService({
          providerSetting,
          projectSettings,
          subject,
          ocrText,
          subjectId: subject.id,
          sourceImageIds: imageIds,
          insertUsageLog: (payload) => store.insertUsageLog(payload),
          jobId: job.id,
          onModelResponse: ({ content }) =>
            store.saveGenerationJobDraftResponse({
              jobId: job.id,
              responseText: content,
            }),
          onParsedPayload: (parsedPayload) =>
            store.saveGenerationJobParsedPayload({
              jobId: job.id,
              parsedPayload,
            }),
          onProgress: (progress) =>
            store.updateGenerationJobProgress({
              jobId: job.id,
              ...progress,
            }),
        })
        const normalizedDraftUnit = {
          ...draftUnit,
          subjectId: subject.id,
          sourceImageIds: imageIds,
        }

        store.insertUnit(normalizedDraftUnit)
        store.completeGenerationJob({
          jobId: job.id,
          draftUnitId: normalizedDraftUnit.id,
          ocrText,
        })
      } catch (error) {
        store.failGenerationJob({
          jobId: job.id,
          errorMessage: error instanceof Error ? error.message : '生成失败',
        })
      }
    })()
  })

  app.get('/api/generation-jobs/:id', authMiddleware(store), (req, res) => {
    const job = store.getGenerationJob(req.params.id)
    if (!job) {
      res.status(404).json({ error: '生成任务不存在' })
      return
    }

    res.json(job)
  })

  app.post('/api/generation-jobs/:id/retry-draft', authMiddleware(store), (req, res) => {
    const sourceJob = store.getGenerationJob(req.params.id)
    if (!sourceJob) {
      res.status(404).json({ error: '生成任务不存在' })
      return
    }

    if (!sourceJob.hasOcrText) {
      res.status(400).json({ error: '这条任务还没有可复用的 OCR 结果，暂时不能直接重试草稿。' })
      return
    }

    const providerKey = sourceJob.provider === 'openai' ? 'openai' : sourceJob.provider === 'aliyun' ? 'qwen' : ''
    const providerSetting = providerKey ? store.getProviderSetting(providerKey) : null
    const subject = store.getSubject(sourceJob.subjectId)
    if (!providerSetting || !subject) {
      res.status(400).json({ error: '缺少草稿重试所需的模型配置或学科信息' })
      return
    }

    const retryJob = store.createDraftRetryJob({
      sourceJobId: sourceJob.id,
      provider: sourceJob.provider,
      model: providerSetting.model,
    })
    if (!retryJob) {
      res.status(404).json({ error: '生成任务不存在' })
      return
    }

    res.status(202).json(retryJob)

    void (async () => {
      try {
        const projectSettings = store.getProjectSettings()
        const cachedOcrText = store.getGenerationJobOcrText(sourceJob.id)
        const cachedParsedPayload = store.getGenerationJobParsedPayload(sourceJob.id)
        const cachedDraftResponse = store.getGenerationJobDraftResponse(sourceJob.id)
        let draftUnit

        if (cachedParsedPayload) {
          store.updateGenerationJobProgress({
            jobId: retryJob.id,
            stage: 'draft',
            processedImages: retryJob.totalImages,
            totalImages: retryJob.totalImages,
            message: '正在基于已缓存的结构化结果重建单元草稿。',
          })
          store.saveGenerationJobParsedPayload({
            jobId: retryJob.id,
            parsedPayload: cachedParsedPayload,
          })
          draftUnit = buildDraftUnitFromModel({
            subjectId: sourceJob.subjectId,
            subjectName: subject.name,
            sourceImageIds: sourceJob.imageIds,
            parsed: cachedParsedPayload,
            projectSettings,
          })
        } else if (cachedDraftResponse) {
          store.updateGenerationJobProgress({
            jobId: retryJob.id,
            stage: 'draft',
            processedImages: retryJob.totalImages,
            totalImages: retryJob.totalImages,
            message: '正在基于已缓存的模型返回结果重试草稿整理。',
          })
          store.saveGenerationJobDraftResponse({
            jobId: retryJob.id,
            responseText: cachedDraftResponse,
          })
          const parsedPayload = parseJsonContent(cachedDraftResponse)
          store.saveGenerationJobParsedPayload({
            jobId: retryJob.id,
            parsedPayload,
          })
          draftUnit = buildDraftUnitFromModel({
            subjectId: sourceJob.subjectId,
            subjectName: subject.name,
            sourceImageIds: sourceJob.imageIds,
            parsed: parsedPayload,
            projectSettings,
          })
        } else {
          draftUnit = await draftGenerationService({
            providerSetting,
            projectSettings,
            subject,
            ocrText: cachedOcrText,
            subjectId: sourceJob.subjectId,
            sourceImageIds: sourceJob.imageIds,
            insertUsageLog: (payload) => store.insertUsageLog(payload),
            jobId: retryJob.id,
            onModelResponse: ({ content }) =>
              store.saveGenerationJobDraftResponse({
                jobId: retryJob.id,
                responseText: content,
              }),
            onParsedPayload: (parsedPayload) =>
              store.saveGenerationJobParsedPayload({
                jobId: retryJob.id,
                parsedPayload,
              }),
            onProgress: (progress) =>
              store.updateGenerationJobProgress({
                jobId: retryJob.id,
                ...progress,
              }),
          })
        }
        const normalizedDraftUnit = {
          ...draftUnit,
          subjectId: sourceJob.subjectId,
          sourceImageIds: sourceJob.imageIds,
        }

        store.insertUnit(normalizedDraftUnit)
        store.completeGenerationJob({
          jobId: retryJob.id,
          draftUnitId: normalizedDraftUnit.id,
          ocrText: cachedOcrText,
        })
      } catch (error) {
        store.failGenerationJob({
          jobId: retryJob.id,
          errorMessage: error instanceof Error ? error.message : '生成失败',
        })
      }
    })()
  })

  app.get('/api/speaking/recordings', userAuthMiddleware(store), (req, res) => {
    const unitId = String(req.query.unitId || '').trim()
    const activityId = String(req.query.activityId || '').trim()
    if (!unitId || !activityId) {
      res.status(400).json({ error: '缺少录音所属关卡信息' })
      return
    }

    res.json(store.listSpeakingRecordings(req.userSession.user.id, unitId, activityId))
  })

  app.post('/api/speaking/recordings', userAuthMiddleware(store), speakingUpload.single('audio'), (req, res) => {
    const audioFile = req.file
    const unitId = String(req.body?.unitId || '').trim()
    const activityId = String(req.body?.activityId || '').trim()
    const durationSeconds = Math.max(0, Number(req.body?.durationSeconds) || 0)
    if (!unitId || !activityId) {
      res.status(400).json({ error: '缺少录音所属关卡信息' })
      return
    }
    if (!audioFile?.path) {
      res.status(400).json({ error: '请先完成录音再上传' })
      return
    }

    const recording = store.createSpeakingRecording({
      userId: req.userSession.user.id,
      unitId,
      activityId,
      filePath: audioFile.path,
      mimeType: audioFile.mimetype || 'audio/webm',
      durationSeconds,
    })
    res.status(201).json(recording)
  })

  app.get('/api/speaking/recordings/:id/audio', userAuthMiddleware(store), (req, res) => {
    const file = store.getSpeakingRecordingFile(req.userSession.user.id, req.params.id)
    if (!file) {
      res.status(404).json({ error: '录音不存在' })
      return
    }

    res.type(file.mimeType || 'audio/webm')
    res.sendFile(file.filePath)
  })

  app.delete('/api/speaking/recordings/:id', userAuthMiddleware(store), (req, res) => {
    const ok = store.deleteSpeakingRecording(req.userSession.user.id, req.params.id)
    if (!ok) {
      res.status(404).json({ error: '录音不存在' })
      return
    }

    res.json({ ok: true })
  })

  app.post('/api/speaking/evaluate', userAuthMiddleware(store), async (req, res) => {
    const transcript = String(req.body?.transcript || '').trim()
    const recordingId = String(req.body?.recordingId || '').trim()
    if (!transcript) {
      res.status(400).json({ error: '缺少目标句子' })
      return
    }
    if (!recordingId) {
      res.status(400).json({ error: '请先选择一条录音再评分' })
      return
    }

    const recordingFile = store.getSpeakingRecordingFile(req.userSession.user.id, recordingId)
    if (!recordingFile?.filePath || !fs.existsSync(recordingFile.filePath)) {
      store.setSpeakingRecordingError(req.userSession.user.id, recordingId, 'load failed')
      res.status(400).json({ error: 'load failed' })
      return
    }

    try {
      const projectSettings = store.getProjectSettings()
      const result = await speakingService({
        activeAiVendor: projectSettings.activeAiVendor,
        passScore: projectSettings.speakingPassScore,
        openAiSetting: store.getProviderSetting('openai'),
        qwenSetting: store.getProviderSetting('qwen'),
        audioBuffer: fs.readFileSync(recordingFile.filePath),
        mimeType: recordingFile.mimeType || 'audio/webm',
        fileName: path.basename(recordingFile.filePath),
        durationSeconds: recordingFile.durationSeconds || 0,
        targetTranscript: transcript,
        insertUsageLog: (payload) => store.insertUsageLog(payload),
      })
      store.updateSpeakingRecordingEvaluation(req.userSession.user.id, recordingId, result)
      res.json({ ...result, recordingId })
    } catch (error) {
      const message = error instanceof Error ? error.message : '口语评分失败'
      store.setSpeakingRecordingError(req.userSession.user.id, recordingId, message)
      res.status(500).json({ error: message })
    }
  })

  app.patch('/api/drafts/:id', authMiddleware(store), (req, res) => {
    const updated = store.updateUnit({
      id: req.params.id,
      ...req.body,
    })
    if (!updated) {
      res.status(404).json({ error: '草稿不存在' })
      return
    }

    res.json(updated)
  })

  app.post('/api/drafts/:id/publish', authMiddleware(store), async (req, res) => {
    const draftUnit = store.findUnit(req.params.id)
    if (!draftUnit) {
      res.status(404).json({ error: '草稿不存在' })
      return
    }

    try {
      const projectSettings = store.getProjectSettings()
      const preparedUnit = await unitAudioService({
        activeAiVendor: projectSettings.activeAiVendor,
        openAiSetting: store.getProviderSetting('openai'),
        qwenSetting: store.getProviderSetting('qwen'),
        audioAssetsDir: store.audioAssetsDir,
        unit: draftUnit,
        subjectId: draftUnit.subjectId,
        insertUsageLog: (payload) => store.insertUsageLog(payload),
      })
      store.updateUnit(preparedUnit)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : '发布前生成音频失败' })
      return
    }

    const unit = store.publishUnit(req.params.id)
    if (!unit) {
      res.status(404).json({ error: '草稿不存在' })
      return
    }

    res.json(unit)
  })

  app.get('/api/settings/providers', authMiddleware(store), (_req, res) => {
    res.json(store.getProviderSettings())
  })

  app.put('/api/settings/project', authMiddleware(store), (req, res) => {
    res.json(store.saveProjectSettings(req.body || {}))
  })

  app.put('/api/settings/providers/:provider', authMiddleware(store), (req, res) => {
    const provider = req.params.provider
    const setting = store.saveProviderSetting(provider, req.body || {})
    res.json(setting)
  })

  app.get('/api/usage-logs', authMiddleware(store), (req, res) => {
    res.json(
      store.listUsageLogs({
        subjectId: req.query.subjectId,
        provider: req.query.provider,
        feature: req.query.feature,
      }),
    )
  })

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error instanceof Error ? error.message : '服务器错误' })
  })

  if (fs.existsSync(path.join(rootDir, 'dist'))) {
    app.use(express.static(path.join(rootDir, 'dist')))
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
        next()
        return
      }
      res.sendFile(path.join(rootDir, 'dist', 'index.html'))
    })
  }

  return app
}
