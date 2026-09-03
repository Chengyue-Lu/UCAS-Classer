import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const REPOSITORY = 'Chengyue-Lu/UCAS-Classer'

function getArg(name, fallback = '') {
  const prefix = `--${name}=`
  const value = process.argv.find((arg) => arg.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

async function pathExists(filePath) {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

const packageRoot = path.resolve(getArg('package-root', 'ucasclasser-package'))
const packageJsonPath = path.join(packageRoot, 'package.json')
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const version = getArg('version', packageJson.version)
const tag = getArg('tag', `v${version}`)
const notes = getArg('notes', `UCAS Classer ${version}`)
const nsisDir = path.join(packageRoot, 'src-tauri/target/release/bundle/nsis')
const outputPath = path.join(packageRoot, getArg('out', 'src-tauri/target/release/bundle/latest.json'))

const files = await readdir(nsisDir)
const updateBundleName = files.find(
  (file) => file.endsWith('_x64-setup.exe') && file.includes(version),
)
if (!updateBundleName) {
  throw new Error(`No NSIS setup executable for version ${version} in ${nsisDir}`)
}

const signaturePath = path.join(nsisDir, `${updateBundleName}.sig`)
if (!(await pathExists(signaturePath))) {
  throw new Error(`Missing updater signature: ${signaturePath}`)
}

const signature = (await readFile(signaturePath, 'utf8')).trim()
const githubAssetName = getArg(
  'asset-name',
  updateBundleName.replaceAll(' ', '.'),
)
const assetUrl = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(githubAssetName)}`
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: assetUrl,
    },
  },
}

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outputPath}`)
console.log(assetUrl)
