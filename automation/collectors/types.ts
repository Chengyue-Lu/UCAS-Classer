export type CourseSummary = {
  courseId: string
  clazzId: string
  cpi: string
  ckenc: string
  courseUrl: string
  role: string | null
  name: string
  teacher: string | null
  state: string | null
  source: string | null
  kcenc: string | null
  clazzenc: string | null
}

export type CourseListSnapshot = {
  collectedAt: string
  browserChannel: string
  checkedUrl: string
  currentUrl: string
  pageTitle: string
  authenticated: boolean
  courseCount: number
  htmlPath: string
  screenshotPath: string
  jsonPath: string
  courses: CourseSummary[]
}

export type CourseModuleUrls = {
  collectedAt: string
  browserChannel: string
  courseId: string
  clazzId: string
  cpi: string
  ckenc: string
  name: string
  teacher: string | null
  courseUrl: string
  courseHomeUrl: string
  pageTitle: string
  materialsUrl: string | null
  noticesUrl: string | null
  assignmentsUrl: string | null
  htmlPath: string
  screenshotPath: string
  jsonPath: string
}

export type MaterialSummary = {
  dataId: string
  name: string
  type: string | null
  objectId: string | null
  uploader: string | null
  size: string | null
  createdAt: string | null
  downloadUrl: string | null
  readUrl: string | null
  source: string | null
}

export type MaterialListSnapshot = {
  collectedAt: string
  browserChannel: string
  courseId: string
  courseName: string
  checkedUrl: string
  currentUrl: string
  pageTitle: string
  itemCount: number
  htmlPath: string
  screenshotPath: string
  jsonPath: string
  items: MaterialSummary[]
}

export type NoticeSummary = {
  title: string
  detailUrl: string | null
  publishedAt: string | null
  publisher: string | null
  rawText: string
}

export type NoticeListSnapshot = {
  collectedAt: string
  browserChannel: string
  courseId: string
  courseName: string
  checkedUrl: string
  currentUrl: string
  pageTitle: string
  itemCount: number
  htmlPath: string
  screenshotPath: string
  jsonPath: string
  items: NoticeSummary[]
}

export type AssignmentSummary = {
  title: string
  workUrl: string | null
  status: string | null
  startTime: string | null
  endTime: string | null
  rawText: string
}

export type AssignmentListSnapshot = {
  collectedAt: string
  browserChannel: string
  courseId: string
  courseName: string
  checkedUrl: string
  currentUrl: string
  pageTitle: string
  itemCount: number
  htmlPath: string
  screenshotPath: string
  jsonPath: string
  items: AssignmentSummary[]
}

export type CourseCollectionSnapshot = {
  collectedAt: string
  courseId: string
  courseName: string
  modules: CourseModuleUrls
  materials: MaterialListSnapshot
  notices: NoticeListSnapshot
  assignments: AssignmentListSnapshot
}

export type FullCollectSummary = {
  startedAt: string
  finishedAt: string
  courseCount: number
  concurrency: number
  successCount: number
  failureCount: number
  jsonPath: string
  courses: Array<{
    courseId: string
    courseName: string
    ok: boolean
    error?: string
    materialCount?: number
    noticeCount?: number
    assignmentCount?: number
  }>
}
