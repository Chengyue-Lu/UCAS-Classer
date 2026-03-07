export const portalUrl = 'https://mooc.ucas.edu.cn/portal'
export const courseListUrl =
  'https://mooc.ucas.edu.cn/fyportal/courselist/course?version=1'

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
