const DEFAULT_BRIDGE_ERROR_MESSAGE = '当前不在 Tauri 环境内，无法执行此操作。'

function getTauriInvoke() {
  return window.__TAURI_INTERNALS__?.invoke ?? window.__TAURI__?.core?.invoke ?? null
}

function getTauriEventListen() {
  return (
    window.__TAURI__?.event?.listen ??
    window.__TAURI_INTERNALS__?.event?.listen ??
    window.__TAURI_INTERNALS__?.plugins?.event?.listen ??
    null
  )
}

async function invokeTauriCommand(command, args = {}) {
  const invoke = getTauriInvoke()
  if (!invoke) {
    return null
  }

  return invoke(command, args)
}

function createBridgeUnavailableError(message = DEFAULT_BRIDGE_ERROR_MESSAGE) {
  const error = new Error(message)
  error.code = 'bridge_unavailable'
  return error
}

function getErrorMessage(error, fallback = '操作失败。') {
  if (error instanceof Error) {
    return error.message || fallback
  }

  return String(error || fallback)
}

async function invokeRequiredTauriCommand(
  command,
  args = {},
  missingBridgeMessage = DEFAULT_BRIDGE_ERROR_MESSAGE,
) {
  const result = await invokeTauriCommand(command, args)
  if (result === null) {
    throw createBridgeUnavailableError(missingBridgeMessage)
  }

  return result
}

async function waitForTauriInvoke(timeoutMs = 4000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const invoke = getTauriInvoke()
    if (invoke) {
      return invoke
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 50)
    })
  }

  return null
}

export {
  DEFAULT_BRIDGE_ERROR_MESSAGE,
  createBridgeUnavailableError,
  getErrorMessage,
  getTauriEventListen,
  getTauriInvoke,
  invokeRequiredTauriCommand,
  invokeTauriCommand,
  waitForTauriInvoke,
}
