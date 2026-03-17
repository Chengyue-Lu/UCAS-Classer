import { fetchAssignmentDetail } from './assignment-detail.js'

type CliOptions = {
  workUrl: string
  assignmentsUrl: string | null
  title: string | null
  startTime: string | null
  endTime: string | null
}

function parseOptionalValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index < 0) {
    return null
  }

  const value = argv[index + 1] ?? ''
  return value.trim() || null
}

function parseArgs(argv: string[]): CliOptions {
  const workUrl = parseOptionalValue(argv, '--work-url') ?? ''
  if (!workUrl) {
    throw new Error('Missing required --work-url argument.')
  }

  return {
    workUrl,
    assignmentsUrl: parseOptionalValue(argv, '--assignments-url'),
    title: parseOptionalValue(argv, '--title'),
    startTime: parseOptionalValue(argv, '--start-time'),
    endTime: parseOptionalValue(argv, '--end-time'),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const detail = await fetchAssignmentDetail(options)
  console.log(JSON.stringify(detail, null, 2))
}

main().catch((error: unknown) => {
  console.error('Failed to fetch assignment detail')
  console.error(error)
  process.exitCode = 1
})
