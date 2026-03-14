import { describe, expect, it } from 'vitest'
import {
  completeActivity,
  createDefaultProgress,
  getRecommendation,
  getScoreStars,
  getTodayStudySummary,
  getUnitProgressPercent,
  syncProgressDerivedState,
} from './learning-progress'
import type { Unit } from './types'

const mockUnit: Unit = {
  id: 'unit-1',
  subjectId: 'subject-1',
  title: 'Unit 1',
  source: 'test',
  stage: '阶段一',
  goal: 'test goal',
  difficulty: 'Starter',
  unlockOrder: 1,
  coverEmoji: '🌤️',
  themeColor: '#48a8f6',
  status: 'published',
  contentOrigin: 'framework',
  sourceImageIds: [],
  rewardRule: {
    starsPerComplete: 2,
    starsPerPerfect: 3,
    unlockAtStars: 8,
    reviewTriggerMistakes: 2,
  },
  vocabularyBank: [],
  vocabulary: [],
  patterns: [],
  contentInventory: [],
  lessons: [
    {
      id: 'lesson-1',
      title: 'Lesson 1',
      order: 1,
      estimatedMinutes: 2,
      sourcePageIds: [],
      sourceLessonLabel: 'LESSON 1',
      vocabularyRefs: [],
      sections: [],
      activities: [
        {
          id: 'warmup-1',
          lessonId: 'lesson-1',
          lessonTitle: 'Lesson 1',
          title: '热身',
          prompt: 'prompt',
          skill: 'read',
          kind: 'warmup',
          durationMinutes: 2,
          cards: [],
        },
      ],
      lessonQuiz: null,
    },
  ],
  reading: {
    id: 'read-1',
    title: 'Read',
    content: 'Read',
    audioText: 'Read',
    question: 'Q',
  },
  activities: [
    {
      id: 'warmup-1',
      lessonId: 'lesson-1',
      lessonTitle: 'Lesson 1',
      title: '热身',
      prompt: 'prompt',
      skill: 'read',
      kind: 'warmup',
      durationMinutes: 2,
      cards: [],
    },
  ],
}

const secondUnit: Unit = {
  ...mockUnit,
  id: 'unit-2',
  title: 'Unit 2',
  unlockOrder: 2,
  lessons: [
    {
      id: 'lesson-2',
      title: 'Lesson 2',
      order: 1,
      estimatedMinutes: 2,
      sourcePageIds: [],
      sourceLessonLabel: 'LESSON 2',
      vocabularyRefs: [],
      sections: [],
      activities: [
        {
          id: 'write-2',
          lessonId: 'lesson-2',
          lessonTitle: 'Lesson 2',
          title: '拼写',
          prompt: 'prompt',
          skill: 'write',
          kind: 'write-spell',
          durationMinutes: 2,
          sentence: 'Hello ____.',
          answer: 'Amy',
          tips: ['首字母大写'],
        },
      ],
      lessonQuiz: null,
    },
  ],
  activities: [
    {
      id: 'write-2',
      lessonId: 'lesson-2',
      lessonTitle: 'Lesson 2',
      title: '拼写',
      prompt: 'prompt',
      skill: 'write',
      kind: 'write-spell',
      durationMinutes: 2,
      sentence: 'Hello ____.',
      answer: 'Amy',
      tips: ['首字母大写'],
    },
  ],
}

describe('learning progress', () => {
  it('updates stars and completion after an activity', () => {
    const progress = createDefaultProgress([mockUnit])
    const next = completeActivity(progress, [mockUnit], mockUnit, mockUnit.activities![0], 100, [], 30, 60)

    expect(next.totalStars).toBe(3)
    expect(getUnitProgressPercent(next, mockUnit)).toBe(100)
    expect(next.completedUnitIds).toContain(mockUnit.id)
  })

  it('keeps the highest score and completed state after a lower retry', () => {
    const progress = createDefaultProgress([mockUnit])
    const first = completeActivity(progress, [mockUnit], mockUnit, mockUnit.activities![0], 100, [], 30, 60)
    const retried = completeActivity(first, [mockUnit], mockUnit, mockUnit.activities![0], 62, ['拼写：demo'], 40, 60)

    expect(retried.activityResults['unit-1:lesson-1:warmup-1'].score).toBe(100)
    expect(retried.activityResults['unit-1:lesson-1:warmup-1'].completed).toBe(true)
    expect(retried.totalStars).toBe(first.totalStars)
  })

  it('preserves higher synced total stars while still deriving per-activity stars under the new thresholds', () => {
    const synced = syncProgressDerivedState(
      {
        ...createDefaultProgress([mockUnit]),
        totalStars: 99,
        activityResults: {
          'unit-1:lesson-1:warmup-1': {
            unitId: 'unit-1',
            lessonId: 'lesson-1',
            activityId: 'warmup-1',
            completed: true,
            score: 80,
            durationSeconds: 30,
            mistakes: [],
            completedAt: new Date().toISOString(),
          },
        },
      },
      [mockUnit],
      60,
    )

    expect(getScoreStars(80, 60)).toBe(2)
    expect(synced.totalStars).toBe(99)
  })

  it('tracks today stats and awards a badge for a perfect unit', () => {
    const progress = createDefaultProgress([mockUnit])
    const next = completeActivity(progress, [mockUnit], mockUnit, mockUnit.activities![0], 100, [], 30, 60)

    const today = getTodayStudySummary(next)
    expect(today.started).toBe(true)
    expect(today.starsGained).toBe(3)
    expect(today.badgesGained).toBe(1)
    expect(today.enough).toBe(true)
  })

  it('recommends the next unfinished unit instead of returning to an already completed first unit', () => {
    const progress = completeActivity(createDefaultProgress([mockUnit, secondUnit]), [mockUnit, secondUnit], mockUnit, mockUnit.activities![0], 100, [], 30, 60)
    const recommendation = getRecommendation(progress, [mockUnit, secondUnit], 60)

    expect(recommendation.unitId).toBe('unit-2')
    expect(recommendation.activityIndex).toBe(0)
    expect(recommendation.cta).toBe('继续学习')
  })
})
