import { collectCourseList } from './course-list.js'

type CliOptions = {
  headed: boolean
}

function parseArgs(argv: string[]): CliOptions {
  return {
    headed: argv.includes('--headed'),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const snapshot = await collectCourseList({
    headed: options.headed,
  })

  console.log(JSON.stringify(snapshot, null, 2))
}

main().catch((error: unknown) => {
  console.error('Failed to collect course list')
  console.error(error)
  process.exitCode = 1
})
