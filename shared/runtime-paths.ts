import { resolve } from 'node:path'

function resolveEnvPath(name: string): string | undefined {
  const value = process.env[name]?.trim()
  if (!value) {
    return undefined
  }

  return resolve(value)
}

const runtimeRoot = resolveEnvPath('UCAS_RUNTIME_ROOT') ?? process.cwd()
const dataRoot = resolveEnvPath('UCAS_DATA_ROOT') ?? resolve(runtimeRoot, 'data')
const configRoot = resolveEnvPath('UCAS_CONFIG_ROOT') ?? runtimeRoot
const cacheDir = resolveEnvPath('UCAS_CACHE_DIR') ?? resolve(dataRoot, 'cache')

export function getRuntimeRoot(): string {
  return runtimeRoot
}

export function resolveRuntimePath(...parts: string[]): string {
  return resolve(runtimeRoot, ...parts)
}

export function getDataRoot(): string {
  return dataRoot
}

export function resolveDataPath(...parts: string[]): string {
  return resolve(dataRoot, ...parts)
}

export function getConfigRoot(): string {
  return configRoot
}

export function resolveConfigPath(...parts: string[]): string {
  return resolve(configRoot, ...parts)
}

export function getCacheDir(): string {
  return cacheDir
}

export function resolveCachePath(...parts: string[]): string {
  return resolve(cacheDir, ...parts)
}
