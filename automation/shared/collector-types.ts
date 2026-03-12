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
  termCategory?: 'current' | 'past' | null
}

export type SemesterOptionSummary = {
  value: string
  semesterNum: string | null
  label: string
  selected: boolean
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
  currentSectionId?: string | null
  currentSemesterNum?: string | null
  currentSemesterLabel?: string | null
  semesterOptions?: SemesterOptionSummary[]
  currentCourses?: CourseSummary[]
  pastCourses?: CourseSummary[]
  currentTermCourseCount?: number
  pastTermCourseCount?: number
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

export type MaterialNodeSummary = {
  nodeId: string
  parentNodeId: string | null
  nodeType: 'file' | 'folder' | 'link' | 'unknown'
  itemIndex: number
  path: string
  depth: number
  dataId: string | null
  folderId: string | null
  name: string
  type: string | null
  objectId: string | null
  uploader: string | null
  size: string | null
  createdAt: string | null
  downloadUrl: string | null
  readUrl: string | null
  openUrl: string | null
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
  fileCount: number
  folderCount: number
  htmlPath: string
  screenshotPath: string
  jsonPath: string
  items: MaterialNodeSummary[]
}

export type NoticeAttachment = {
  name: string
  url: string
}

export type NoticeSummary = {
  noticeId: string
  noticeEnc: string | null
  title: string
  detailUrl: string | null
  publishedAt: string | null
  publisher: string | null
  rawText: string
  detailText: string | null
  detailHtml: string | null
  detailCollectedAt: string | null
  attachments: NoticeAttachment[]
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
  workId?: string | null
  workAnswerId?: string | null
  reEdit?: string | null
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
