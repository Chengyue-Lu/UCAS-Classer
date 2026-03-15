function normalizeRelativeSubdir(relativeDir) {
  if (!relativeDir) {
    return ''
  }

  const segments = String(relativeDir)
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '..' || segment.includes(':'))
  ) {
    return ''
  }

  return segments.join('/')
}

function normalizeCourseDownloadSubdirs(courseDownloadSubdirs = {}) {
  return Object.fromEntries(
    Object.entries(courseDownloadSubdirs)
      .map(([courseId, relativeDir]) => [courseId, normalizeRelativeSubdir(relativeDir)])
      .filter(([, relativeDir]) => relativeDir),
  )
}

function joinRelativeSubdirs(...parts) {
  const segments = parts
    .flatMap((part) => normalizeRelativeSubdir(part).split('/'))
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.join('/')
}

function normalizeSystemPath(path) {
  return String(path || '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
}

function isPathInsideBase(basePath, selectedPath) {
  const normalizedBase = normalizeSystemPath(basePath).replace(/\\$/, '')
  const normalizedSelected = normalizeSystemPath(selectedPath).replace(/\\$/, '')

  if (!normalizedBase || !normalizedSelected) {
    return false
  }

  const baseLower = normalizedBase.toLowerCase()
  const selectedLower = normalizedSelected.toLowerCase()
  return selectedLower === baseLower || selectedLower.startsWith(`${baseLower}\\`)
}

function toRelativeSubdir(basePath, selectedPath) {
  if (!isPathInsideBase(basePath, selectedPath)) {
    return ''
  }

  const normalizedBase = normalizeSystemPath(basePath).replace(/\\$/, '')
  const normalizedSelected = normalizeSystemPath(selectedPath).replace(/\\$/, '')
  if (normalizedSelected.length <= normalizedBase.length) {
    return ''
  }

  return normalizeRelativeSubdir(normalizedSelected.slice(normalizedBase.length + 1))
}

function getCourseSubdirSelectionPath(downloadDir, relativeSubdir) {
  const basePath = normalizeSystemPath(downloadDir)
  if (!basePath) {
    return ''
  }

  const normalizedRelative = normalizeRelativeSubdir(relativeSubdir)
  if (!normalizedRelative) {
    return basePath
  }

  return `${basePath}\\${normalizedRelative.replace(/\//g, '\\')}`
}

export {
  getCourseSubdirSelectionPath,
  isPathInsideBase,
  joinRelativeSubdirs,
  normalizeCourseDownloadSubdirs,
  normalizeRelativeSubdir,
  normalizeSystemPath,
  toRelativeSubdir,
}
