// Compatibility barrel for request collectors. New code should prefer the
// domain modules directly, while existing callers can keep importing here.
export {
  createRequestContext,
  fetchHtml,
  looksLikeLoginBody,
  normalizeText,
  normalizeTextLikeBrowser,
  resolveModuleUrlsFromHtml,
  type RequestApiContext,
  type RequestPageFetch,
} from './request-core.js'
export { collectRequestMaterials } from './material-parser.js'
export { extractAssignments, fillPendingAssignmentWorkUrls } from './assignment-parser.js'
export { extractNotices, fillNoticeDetails } from './notice-parser.js'
