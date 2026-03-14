import type { Activity, Lesson, SkillTag, Unit } from './types'

export interface LessonActivityRef {
  lesson: Lesson
  lessonIndex: number
  activity: Activity
  activityIndex: number
  flatIndex: number
}

export const getActivityProgressKey = (unitId: string, lessonId: string, activityId: string) => `${unitId}:${lessonId}:${activityId}`

const buildLegacyLesson = (unit: Unit): Lesson | null => {
  const legacyActivities = Array.isArray(unit.activities) ? unit.activities : []
  if (!legacyActivities.length) {
    return null
  }

  const lessonId = `${unit.id}-lesson-1`
  const activities = legacyActivities.map((activity) => ({
    ...activity,
    lessonId: activity.lessonId || lessonId,
    lessonTitle: activity.lessonTitle || `${unit.title} Lesson 1`,
  }))
  const estimatedMinutes = activities.reduce((total, activity) => total + (activity.durationMinutes || 0), 0)

  return {
    id: lessonId,
    title: `${unit.title} Lesson 1`,
    order: 1,
    estimatedMinutes,
    sourcePageIds: unit.sourceImageIds || [],
    sourceLessonLabel: 'LESSON 1',
    vocabularyRefs: (unit.vocabularyBank || unit.vocabulary || []).map((item) => item.id),
    sections: (['listen', 'speak', 'read', 'write'] as SkillTag[]).map((skill) => {
      const activityIds = activities.filter((activity) => activity.skill === skill).map((activity) => activity.id)
      return {
        id: `${lessonId}-${skill}`,
        skill,
        title: skill.toUpperCase(),
        activityIds,
        estimatedMinutes: activities
          .filter((activity) => activity.skill === skill)
          .reduce((total, activity) => total + (activity.durationMinutes || 0), 0),
      }
    }),
    activities,
    lessonQuiz: activities.find((activity) => activity.kind === 'challenge') || null,
  }
}

export const getUnitLessons = (unit?: Unit | null) => {
  if (!unit) {
    return []
  }

  if (Array.isArray(unit.lessons) && unit.lessons.length > 0) {
    return unit.lessons
  }

  const legacyLesson = buildLegacyLesson(unit)
  return legacyLesson ? [legacyLesson] : []
}

export const flattenLessonActivities = (unit?: Unit | null): LessonActivityRef[] => {
  if (!unit) {
    return []
  }

  const refs: LessonActivityRef[] = []
  getUnitLessons(unit).forEach((lesson, lessonIndex) => {
    lesson.activities.forEach((activity, activityIndex) => {
      refs.push({
        lesson,
        lessonIndex,
        activity,
        activityIndex,
        flatIndex: refs.length,
      })
    })
  })
  return refs
}

export const getUnitActivityCount = (unit?: Unit | null) => flattenLessonActivities(unit).length

export const getUnitEstimatedMinutes = (unit?: Unit | null) =>
  getUnitLessons(unit).reduce((total, lesson) => total + (lesson.estimatedMinutes || 0), 0)

export const getLessonEstimatedMinutes = (lesson?: Lesson | null) =>
  lesson?.estimatedMinutes || lesson?.activities.reduce((total, activity) => total + (activity.durationMinutes || 0), 0) || 0

export const findLessonActivityRef = (unit: Unit | null | undefined, flatIndex: number) => flattenLessonActivities(unit)[flatIndex] || null
