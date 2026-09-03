import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAuthenticatedSepLandingUrl,
  moocSessionBootstrapUrl,
  sepMoocBridgeUrl,
} from './config.js'

test('recognizes the observed authenticated SEP landing pages', () => {
  assert.equal(
    isAuthenticatedSepLandingUrl('https://sep.ucas.ac.cn/portal/site/441/2142'),
    true,
  )
  assert.equal(
    isAuthenticatedSepLandingUrl('https://sep.ucas.ac.cn/sepCard/card'),
    true,
  )
})

test('does not redirect login or device-verification pages', () => {
  assert.equal(
    isAuthenticatedSepLandingUrl(
      'https://sep.ucas.ac.cn/d_index/Z2tkenhfbG9jYWw=/',
    ),
    false,
  )
  assert.equal(
    isAuthenticatedSepLandingUrl('https://sep.ucas.ac.cn/user/userVisit'),
    false,
  )
  assert.equal(
    isAuthenticatedSepLandingUrl('https://sep.ucas.ac.cn/portal/another-step'),
    false,
  )
  assert.equal(
    isAuthenticatedSepLandingUrl(
      'https://passport2.chaoxing.com/login?loginType=4',
    ),
    false,
  )
})

test('builds the SEP bridge with the official UCAS Online target', () => {
  const bridge = new URL(sepMoocBridgeUrl)

  assert.equal(bridge.origin, 'https://sep.ucas.ac.cn')
  assert.equal(bridge.pathname, '/portal/siteToUrl/441/001')
  assert.equal(bridge.searchParams.get('toUrl'), moocSessionBootstrapUrl)
})
