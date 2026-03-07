import { writeFile } from 'node:fs/promises'
import { launchBrowser } from './browser.js'
import { courseListUrl, portalUrl } from './config.js'
import { authPaths, ensureAuthDirs } from './paths.js'
import { latestPage, prompt, summarizeContext, writeArtifacts } from './utils.js'

async function main() {
  await ensureAuthDirs()

  const { browser, browserChannel } = await launchBrowser(false)
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(portalUrl, { waitUntil: 'domcontentloaded' })

    console.log(`Browser: ${browserChannel}`)
    console.log(`Portal: ${portalUrl}`)
    console.log(`Target: ${courseListUrl}`)
    console.log('')
    console.log('1. 在打开的浏览器里手动登录。')
    console.log('2. 登录后，在同一个浏览器里手动打开课程列表页。')
    console.log('3. 确认课程列表页已经是登录状态。')
    console.log('4. 回到终端，按一次回车，让脚本导出 storageState。')
    console.log('')

    await prompt('完成后按回车保存 storageState。')

    await context.storageState({ path: authPaths.storageStateFile })
    const summary = await summarizeContext(context, browserChannel, courseListUrl)
    const artifacts = await writeArtifacts(latestPage(context), 'after-login-save')

    await writeFile(
      authPaths.metadataFile,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          portalUrl,
          courseListUrl,
          ...summary,
          ...artifacts,
        },
        null,
        2,
      ),
      'utf8',
    )

    console.log(
      JSON.stringify(
        {
          storageStateFile: authPaths.storageStateFile,
          metadataFile: authPaths.metadataFile,
          ...summary,
          ...artifacts,
        },
        null,
        2,
      ),
    )
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error('Failed to save login storage state')
  console.error(error)
  process.exitCode = 1
})
