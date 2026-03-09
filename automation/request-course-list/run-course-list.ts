import { collectCourseListByRequest } from './course-list.js'

async function main() {
  const snapshot = await collectCourseListByRequest()
  console.log(JSON.stringify(snapshot, null, 2))
}

main().catch((error: unknown) => {
  console.error('Failed to collect course list by request')
  console.error(error)
  process.exitCode = 1
})
