export const portalUrl = 'https://mooc.ucas.edu.cn/portal'
export const courseListUrl =
  'https://mooc.ucas.edu.cn/fyportal/courselist/course?version=1'
export const moocSessionBootstrapUrl =
  'https://mooc.ucas.edu.cn/courselist/mycourse'

const sepOrigin = 'https://sep.ucas.ac.cn'
const authenticatedSepLandingPaths = new Set([
  '/portal/site/441/2142',
  '/sepcard/card',
])

export const sepMoocBridgeUrl = (() => {
  const url = new URL('/portal/siteToUrl/441/001', sepOrigin)
  url.searchParams.set('toUrl', moocSessionBootstrapUrl)
  return url.toString()
})()

export function isAuthenticatedSepLandingUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.hostname.toLowerCase() !== 'sep.ucas.ac.cn') {
      return false
    }

    const pathname = url.pathname.toLowerCase().replace(/\/+$/, '') || '/'
    return authenticatedSepLandingPaths.has(pathname)
  } catch {
    return false
  }
}

const loginIndicators = [
  '/passport/login',
  '/login',
  '/sso',
  '/cas',
  'passport.ucas',
  'passport2.chaoxing.com',
]

export function looksLikeLoginUrl(url: string): boolean {
  const normalized = url.toLowerCase()
  return loginIndicators.some((indicator) => normalized.includes(indicator))
}
