import { runRequestFullCollect } from './full-collect.js'

type CliOptions = {
  concurrency?: number
  headed: boolean
}

function parseArgs(argv: string[]): CliOptions {
  let concurrency: number | undefined
  const headed = argv.includes('--headed')

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--concurrency') {
      const value = Number(argv[index + 1] ?? '')
      if (Number.isFinite(value) && value > 0) {
        concurrency = value
      }
      index += 1
    }
  }

  return {
    concurrency,
    headed,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const summary = await runRequestFullCollect(options)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  console.error('Failed to run request-driven full collection')
  console.error(error)
  process.exitCode = 1
})
