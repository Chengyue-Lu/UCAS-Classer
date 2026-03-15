export function createDockController({
  appShell,
  dockHandle,
  state,
  closeDetailModal,
  invokeTauriCommand,
  getTauriEventListen,
}) {
  let dockCollapseTimer = null
  let dockStatePollTimer = null
  let dockStateEventUnlisten = null
  let dockStateEventsAvailable = false

  function clearDockStateEventSubscription() {
    if (typeof dockStateEventUnlisten === 'function') {
      dockStateEventUnlisten()
    }
    dockStateEventUnlisten = null
    dockStateEventsAvailable = false
  }

  function clearDockCollapseTimer() {
    if (dockCollapseTimer !== null) {
      window.clearTimeout(dockCollapseTimer)
      dockCollapseTimer = null
    }
  }

  function clearDockStatePollTimer() {
    if (dockStatePollTimer !== null) {
      window.clearInterval(dockStatePollTimer)
      dockStatePollTimer = null
    }
  }

  function getNormalizedWindowDockState(dockState) {
    return {
      enabled: Boolean(dockState?.enabled),
      state: dockState?.state || 'normal',
      side: dockState?.side || null,
    }
  }

  function renderDockSurface() {
    const dockState = state.windowDock
    appShell.dataset.dockState = dockState.state || 'normal'
    appShell.dataset.dockSide = dockState.side || ''
    dockHandle.hidden = dockState.state !== 'collapsed'
  }

  function handleWindowDockStateEffects(previousDockState, nextDockState) {
    if (
      nextDockState.state === 'collapsed' &&
      previousDockState.state !== 'collapsed' &&
      state.modalOpen
    ) {
      closeDetailModal()
    }

    if (nextDockState.state !== 'expanded') {
      clearDockCollapseTimer()
    }
  }

  function applyWindowDockState(dockState) {
    const previousDockState = state.windowDock
    const nextDockState = getNormalizedWindowDockState(dockState)
    state.windowDock = {
      ...nextDockState,
    }
    renderDockSurface()
    handleWindowDockStateEffects(previousDockState, nextDockState)
  }

  async function subscribeDockStateEvents() {
    clearDockStateEventSubscription()
    dockStateEventsAvailable = false
    const listen = getTauriEventListen()
    if (!listen) {
      return false
    }

    try {
      const unlisten = await listen('dock-state-changed', (event) => {
        if (!event?.payload) {
          return
        }

        applyWindowDockState(event.payload)
      })

      dockStateEventUnlisten = typeof unlisten === 'function' ? unlisten : null
      dockStateEventsAvailable = true
      return true
    } catch (error) {
      console.warn('Failed to subscribe dock-state-changed event', error)
      dockStateEventUnlisten = null
      dockStateEventsAvailable = false
      return false
    }
  }

  async function getWindowDockState() {
    const dockState = await invokeTauriCommand('get_window_dock_state')
    if (!dockState) {
      return {
        enabled: Boolean(state.settings.enableAutoDockCollapse),
        state: 'normal',
        side: null,
      }
    }

    return dockState
  }

  async function refreshWindowDockState() {
    const dockState = await getWindowDockState()
    applyWindowDockState(dockState)
  }

  async function expandDockedWindow() {
    clearDockCollapseTimer()
    await invokeTauriCommand('expand_docked_window')
    if (!dockStateEventsAvailable) {
      await refreshWindowDockState()
    }
  }

  async function collapseDockedWindow() {
    clearDockCollapseTimer()
    await invokeTauriCommand('collapse_docked_window')
    if (!dockStateEventsAvailable) {
      await refreshWindowDockState()
    }
  }

  function scheduleDockCollapse() {
    if (state.modalOpen || state.windowDock.state !== 'expanded') {
      return
    }

    clearDockCollapseTimer()
    dockCollapseTimer = window.setTimeout(() => {
      dockCollapseTimer = null
      collapseDockedWindow()
    }, 400)
  }

  function bindDockInteractions() {
    if (!dockHandle) {
      return
    }

    dockHandle.addEventListener('mouseenter', () => {
      if (state.windowDock.state === 'collapsed') {
        expandDockedWindow()
      }
    })

    appShell.addEventListener('mouseenter', () => {
      clearDockCollapseTimer()
    })

    appShell.addEventListener('mouseleave', (event) => {
      if (event.relatedTarget === null) {
        scheduleDockCollapse()
      }
    })
  }

  function startDockStatePolling() {
    clearDockStatePollTimer()
    dockStatePollTimer = window.setInterval(() => {
      refreshWindowDockState()
    }, dockStateEventsAvailable ? 12000 : 1500)
  }

  async function initializeDockSync() {
    await subscribeDockStateEvents()
    await refreshWindowDockState()
    startDockStatePolling()
  }

  return {
    bindDockInteractions,
    clearDockCollapseTimer,
    initializeDockSync,
    refreshWindowDockState,
    renderDockSurface,
  }
}
