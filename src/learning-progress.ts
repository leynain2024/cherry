import type { Activity, DailyStat, Recommendation, SpeakingPassScore, StudentProgress, TodayStudySummary, Unit, WeakPoint } from './types'

const STORAGE_KEY = 'haibao-learning-progress'

const formatDateKey = (value: Date | string = new Date()) => {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = () => formatDateKey()

export const createDefaultProgress = (units: Unit[]): StudentProgress => ({
  childName: '海宝同学',
  currentUnitId: units[0]?.id || '',
  totalStars: 0,
  streakDays: 1,
  lastActiveDate: today(),
  completedUnitIds: [],
  activityResults: {},
  weakPoints: [],
  dailyStats: {},
})

export const getScoreStars = (score: number, speakingPassScore: SpeakingPassScore) => {
  if (score === 100) {
    return 3
  }
  if (score >= 80) {
    return 2
  }
  if (score >= speakingPassScore) {
    return 1
  }
  return 0
}

const isActivityPassed = (activity: Activity, score: number, speakingPassScore: SpeakingPassScore) => {
  if (activity.kind === 'warmup') {
    return true
  }
  if (activity.kind === 'write-spell') {
    return score === 100
  }

  return score >= speakingPassScore
}

const getCompletedUnitIds = (activityResults: StudentProgress['activityResults'], units: Unit[]) =>
  units
    .filter((unit) => unit.activities.length > 0 && unit.activities.every((activity) => activityResults[resultKey(unit.id, activity.id)]?.completed))
    .map((unit) => unit.id)

export const getActivityStars = (
  activityResults: StudentProgress['activityResults'],
  unitId: string,
  activityId: string,
  speakingPassScore: SpeakingPassScore,
) => {
  const result = activityResults[resultKey(unitId, activityId)]
  if (!result?.completed) {
    return 0
  }

  return getScoreStars(result.score, speakingPassScore)
}

export const getUnitStarCount = (
  activityResults: StudentProgress['activityResults'],
  unit: Unit,
  speakingPassScore: SpeakingPassScore,
) =>
  unit.activities.reduce((total, activity) => total + getActivityStars(activityResults, unit.id, activity.id, speakingPassScore), 0)

export const getPerfectUnitIds = (
  activityResults: StudentProgress['activityResults'],
  units: Unit[],
  speakingPassScore: SpeakingPassScore,
) =>
  units
    .filter(
      (unit) =>
        unit.activities.length > 0 &&
        unit.activities.every((activity) => getActivityStars(activityResults, unit.id, activity.id, speakingPassScore) === 3),
    )
    .map((unit) => unit.id)

const recomputeTotalStars = (
  activityResults: StudentProgress['activityResults'],
  units: Unit[],
  speakingPassScore: SpeakingPassScore,
) =>
  units.reduce((total, unit) => total + getUnitStarCount(activityResults, unit, speakingPassScore), 0)

export const syncProgressDerivedState = (
  progress: StudentProgress,
  units: Unit[],
  speakingPassScore: SpeakingPassScore,
): StudentProgress => ({
  ...progress,
  currentUnitId: progress.currentUnitId || units[0]?.id || '',
  completedUnitIds: getCompletedUnitIds(progress.activityResults, units),
  totalStars: recomputeTotalStars(progress.activityResults, units, speakingPassScore),
  dailyStats: progress.dailyStats || {},
})

export const loadProgress = (units: Unit[], speakingPassScore: SpeakingPassScore = 60) => {
  if (typeof window === 'undefined') {
    return createDefaultProgress(units)
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return createDefaultProgress(units)
  }

  try {
    const parsed = JSON.parse(raw) as StudentProgress
    return syncProgressDerivedState({
      ...createDefaultProgress(units),
      ...parsed,
      currentUnitId: parsed.currentUnitId || units[0]?.id || '',
    }, units, speakingPassScore)
  } catch {
    return createDefaultProgress(units)
  }
}

export const saveProgress = (progress: StudentProgress) => {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
}

const resultKey = (unitId: string, activityId: string) => `${unitId}:${activityId}`

const updateWeakPoints = (weakPoints: WeakPoint[], mistakes: string[]) => {
  const next = new Map(weakPoints.map((item) => [item.id, { ...item }]))
  mistakes.forEach((mistake) => {
    const type = mistake.includes('拼写') ? 'spelling' : mistake.includes('句型') ? 'pattern' : 'vocabulary'
    const id = `${type}:${mistake}`
    const current = next.get(id)
    next.set(id, {
      id,
      label: mistake,
      type,
      misses: current ? current.misses + 1 : 1,
    })
  })
  return Array.from(next.values()).sort((left, right) => right.misses - left.misses)
}

export const getUnitProgressPercent = (progress: StudentProgress, unit: Unit) => {
  const completed = unit.activities.filter((activity) => {
    return progress.activityResults[resultKey(unit.id, activity.id)]?.completed
  }).length
  return unit.activities.length ? Math.round((completed / unit.activities.length) * 100) : 0
}

export const completeActivity = (
  progress: StudentProgress,
  units: Unit[],
  unit: Unit,
  activity: Activity,
  score: number,
  mistakes: string[],
  durationSeconds: number,
  speakingPassScore: SpeakingPassScore,
) => {
  const key = resultKey(unit.id, activity.id)
  const previous = progress.activityResults[key]
  const previousPerfectUnitIds = getPerfectUnitIds(progress.activityResults, units, speakingPassScore)
  const passed = Boolean(previous?.completed) || isActivityPassed(activity, score, speakingPassScore)
  const bestScore = Math.max(previous?.score || 0, score)
  const keepPreviousAttempt = Boolean(previous && previous.score >= score)
  const nowIso = new Date().toISOString()
  const nextResults = {
    ...progress.activityResults,
    [key]: {
      unitId: unit.id,
      activityId: activity.id,
      completed: passed,
      score: bestScore,
      durationSeconds: keepPreviousAttempt ? previous.durationSeconds : durationSeconds,
      mistakes: keepPreviousAttempt ? previous.mistakes : mistakes,
      completedAt: passed ? previous?.completedAt || nowIso : previous?.completedAt || nowIso,
    },
  }
  const unitCompleted = unit.activities.every((item) => nextResults[resultKey(unit.id, item.id)]?.completed)
  const prevStars = previous?.completed ? getScoreStars(previous.score, speakingPassScore) : 0
  const nextStars = passed ? getScoreStars(bestScore, speakingPassScore) : 0
  const nextPerfectUnitIds = getPerfectUnitIds(nextResults, units, speakingPassScore)
  const badgeGain = nextPerfectUnitIds.filter((unitId) => !previousPerfectUnitIds.includes(unitId)).length
  const dailyKey = today()
  const previousDaily: DailyStat = progress.dailyStats?.[dailyKey] || {
    date: dailyKey,
    durationSeconds: 0,
    starsGained: 0,
    badgesGained: 0,
  }
  return {
    ...progress,
    currentUnitId: unit.id,
    totalStars: progress.totalStars + (nextStars - prevStars),
    streakDays: progress.lastActiveDate === today() ? progress.streakDays : progress.streakDays + 1,
    lastActiveDate: today(),
    completedUnitIds: unitCompleted
      ? Array.from(new Set([...getCompletedUnitIds(nextResults, units), unit.id]))
      : getCompletedUnitIds(nextResults, units),
    activityResults: nextResults,
    weakPoints: updateWeakPoints(progress.weakPoints, mistakes),
    dailyStats: {
      ...(progress.dailyStats || {}),
      [dailyKey]: {
        date: dailyKey,
        durationSeconds: previousDaily.durationSeconds + durationSeconds,
        starsGained: previousDaily.starsGained + Math.max(0, nextStars - prevStars),
        badgesGained: previousDaily.badgesGained + badgeGain,
      },
    },
  }
}

export const getTodayStudySummary = (progress: StudentProgress, speakingPassScore: SpeakingPassScore = 60): TodayStudySummary => {
  const date = today()
  const daily = progress.dailyStats?.[date]
  const todayResults = Object.values(progress.activityResults).filter(
    (result) => result.completed && formatDateKey(result.completedAt) === date,
  )
  const completedParts = todayResults.length
  const durationSeconds = todayResults.reduce((total, result) => total + (result.durationSeconds || 0), 0)
  const starsGained = todayResults.reduce((total, result) => total + getScoreStars(result.score, speakingPassScore), 0)

  return {
    date,
    durationSeconds: Math.max(durationSeconds, daily?.durationSeconds || 0),
    starsGained: Math.max(starsGained, daily?.starsGained || 0),
    badgesGained: daily?.badgesGained || 0,
    completedParts,
    started: Boolean(
      completedParts > 0 || durationSeconds > 0 || starsGained > 0 || (daily && daily.badgesGained > 0),
    ),
    enough: (daily?.badgesGained || 0) >= 1,
  }
}

const findNextTarget = (progress: StudentProgress, units: Unit[], speakingPassScore: SpeakingPassScore) => {
  if (!units.length) {
    return null
  }

  const orderedUnits = [...units].sort((left, right) => left.unlockOrder - right.unlockOrder)
  const currentIndex = Math.max(0, orderedUnits.findIndex((unit) => unit.id === progress.currentUnitId))
  const inPriorityOrder = [...orderedUnits.slice(currentIndex), ...orderedUnits.slice(0, currentIndex)]

  const findActivityIndex = (unit: Unit, matcher: (activity: Activity) => boolean) => unit.activities.findIndex(matcher)

  for (const unit of inPriorityOrder) {
    const activityIndex = findActivityIndex(
      unit,
      (activity) => !progress.activityResults[resultKey(unit.id, activity.id)]?.completed,
    )
    if (activityIndex >= 0) {
      return { unit, activityIndex }
    }
  }

  for (const unit of inPriorityOrder) {
    const activityIndex = findActivityIndex(
      unit,
      (activity) => getActivityStars(progress.activityResults, unit.id, activity.id, speakingPassScore) < 3,
    )
    if (activityIndex >= 0) {
      return { unit, activityIndex }
    }
  }

  return { unit: orderedUnits[currentIndex] || orderedUnits[0], activityIndex: 0 }
}

export const getRecommendation = (
  progress: StudentProgress,
  units: Unit[],
  speakingPassScore: SpeakingPassScore,
): Recommendation => {
  const target = findNextTarget(progress, units, speakingPassScore)
  const todaySummary = getTodayStudySummary(progress, speakingPassScore)

  if (!target) {
    return {
      title: '等待内容发布',
      subtitle: '后台发布单元后，这里会出现推荐任务。',
      unitId: '',
      activityIndex: 0,
      cta: '稍后再来',
    }
  }

  const { unit, activityIndex } = target
  const currentPercent = getUnitProgressPercent(progress, unit)
  const hasProgressToday = todaySummary.started

  if (todaySummary.enough) {
    return {
      title: '今天已经学习足够了',
      subtitle:
        progress.weakPoints[0]
          ? `今天已完成整单元学习。如果还想继续，可以回顾：${progress.weakPoints[0].label}`
          : '今天已经完成整单元学习，可以复习薄弱点，或者轻松回看已学内容。',
      unitId: unit.id,
      activityIndex,
      cta: '继续学习',
    }
  }

  if (hasProgressToday) {
    return {
      title: `继续 ${unit.title}`,
      subtitle:
        currentPercent > 0 && currentPercent < 100
          ? `今天已经开始学习，继续完成 ${unit.title} 吧。`
          : `今天已经获得 ${todaySummary.starsGained} 颗星，继续挑战下一关。`,
      unitId: unit.id,
      activityIndex,
      cta: '继续学习',
    }
  }

  if (progress.weakPoints[0] && currentPercent === 100) {
    return {
      title: '来一次复习挑战',
      subtitle: `优先回顾：${progress.weakPoints[0].label}`,
      unitId: unit.id,
      activityIndex,
      cta: '进入复习',
    }
  }

  return {
    title: currentPercent > 0 ? `继续 ${unit.title}` : `开始 ${unit.title}`,
    subtitle: currentPercent > 0 ? '继续当前主线，向满星和勋章推进。' : '从下一步主线任务开始今天的学习。',
    unitId: unit.id,
    activityIndex,
    cta: currentPercent > 0 ? '继续学习' : '开始学习',
  }
}

export const summarizeWeakPoints = (progress: StudentProgress) =>
  progress.weakPoints.slice(0, 3).map((item) => `${item.label} (${item.misses}次)`)
