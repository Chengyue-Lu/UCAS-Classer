import { collectAssignmentList } from './assignment-list.js'
import { collectCourseList } from './course-list.js'
import { collectMaterialList } from './material-list.js'
import { collectCourseModuleUrls } from './module-urls.js'
import { collectNoticeList } from './notice-list.js'
import { collectorPaths } from './paths.js'
import type { CourseSummary, FullCollectSummary } from './types.js'
import {
  pruneStaleCourseCache,
  runWithConcurrency,
  writeJsonFile,
} from './utils.js'

export async function runFullCollect(options?: {
  concurrency?: number
  headed?: boolean
}): Promise<FullCollectSummary> {
  const startedAt = new Date().toISOString()
  const courseList = await collectCourseList({
    headed: options?.headed,
  })

  await pruneStaleCourseCache(courseList.courses.map((course) => course.courseId))

  const concurrency = Math.max(
    1,
    Math.min(options?.concurrency ?? 4, courseList.courses.length || 1),
  )

  const results = await runWithConcurrency(
    courseList.courses,
    concurrency,
    async (course: CourseSummary) => {
      try {
        const modules = await collectCourseModuleUrls(course, {
          headed: options?.headed,
        })
        const [materials, notices, assignments] = await Promise.all([
          collectMaterialList(modules, { headed: options?.headed }),
          collectNoticeList(modules, { headed: options?.headed }),
          collectAssignmentList(modules, { headed: options?.headed }),
        ])

        return {
          courseId: course.courseId,
          courseName: course.name,
          ok: true,
          materialCount: materials.itemCount,
          noticeCount: notices.itemCount,
          assignmentCount: assignments.itemCount,
        }
      } catch (error) {
        return {
          courseId: course.courseId,
          courseName: course.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )

  const summary: FullCollectSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    courseCount: courseList.courseCount,
    concurrency,
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    jsonPath: collectorPaths.fullCollectSummaryJson,
    courses: results,
  }

  await writeJsonFile(summary.jsonPath, summary)
  await writeJsonFile(collectorPaths.moduleIndexJson, {
    collectedAt: summary.finishedAt,
    courseCount: courseList.courseCount,
    courses: courseList.courses,
  })

  return summary
}
