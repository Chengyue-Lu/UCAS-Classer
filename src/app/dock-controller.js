const DOCK_COLLAPSE_DELAY_MS = 400
const DOCK_RESIZE_SETTLE_MS = 900

export function getDockCollapseDelay(now, resizeCooldownUntil) {
  return Math.max(DOCK_COLLAPSE_DELAY_MS, resizeCooldownUntil - now)
}

// Keeps dock state synchronization isolated from the rest of the page logic.
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
  let dockActionInFlight = null
  let dockResizeCooldownUntil = 0
  let dockStateRefreshSequence = 0
  let dockStateEventSequence = 0

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
      transitioning: Boolean(dockState?.transitioning),
    }
  }

  function renderDockSurface() {
    const dockState = state.windowDock
    appShell.dataset.dockState = dockState.state || 'normal'
    appShell.dataset.dockSide = dockState.side || ''
    appShell.dataset.dockTransition = dockState.transitioning ? 'true' : 'false'
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

    if (nextDockState.transitioning || nextDockState.state !== 'expanded') {
      clearDockCollapseTimer()
      dockResizeCooldownUntil = 0
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

        dockStateEventSequence += 1
        dockStateRefreshSequence += 1
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
        transitioning: false,
      }
    }

    return dockState
  }

  async function refreshWindowDockState() {
    const refreshSequence = ++dockStateRefreshSequence
    const eventSequence = dockStateEventSequence
    const dockState = await getWindowDockState()
    if (
      refreshSequence !== dockStateRefreshSequence ||
      eventSequence !== dockStateEventSequence
    ) {
      return
    }
    applyWindowDockState(dockState)
  }

  async function runDockAction(command) {
    if (dockActionInFlight) {
      return dockActionInFlight
    }

    clearDockCollapseTimer()
    const action = (async () => {
      dockStateRefreshSequence += 1
      state.windowDock = {
        ...state.windowDock,
        transitioning: true,
      }
      renderDockSurface()
      await waitForDockTransitionPaint()
      await invokeTauriCommand(command)
      await refreshWindowDockState()
    })()
    dockActionInFlight = action

    try {
      await action
    } catch (error) {
      state.windowDock = {
        ...state.windowDock,
        transitioning: false,
      }
      renderDockSurface()
      throw error
    } finally {
      if (dockActionInFlight === action) {
        dockActionInFlight = null
      }
    }
  }

  async function expandDockedWindow() {
    return runDockAction('expand_docked_window')
  }

  async function collapseDockedWindow() {
    return runDockAction('collapse_docked_window')
  }

  function isPointerWithinDockSurface() {
    return typeof appShell.matches === 'function' && appShell.matches(':hover')
  }

  function waitForDockTransitionPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve)
      })
    })
  }

  function scheduleDockCollapse() {
    if (
      state.modalOpen ||
      state.windowDock.transitioning ||
      state.windowDock.state !== 'expanded'
    ) {
      return
    }

    // The base delay prevents accidental collapse while the cursor crosses the
    // edge. Active resize gestures extend it so resizing cannot race a collapse.
    clearDockCollapseTimer()
    const delay = getDockCollapseDelay(Date.now(), dockResizeCooldownUntil)
    dockCollapseTimer = window.setTimeout(() => {
      dockCollapseTimer = null
      if (
        state.modalOpen ||
        state.windowDock.transitioning ||
        state.windowDock.state !== 'expanded'
      ) {
        return
      }
      if (Date.now() < dockResizeCooldownUntil) {
        scheduleDockCollapse()
        return
      }
      if (isPointerWithinDockSurface()) {
        return
      }
      void collapseDockedWindow().catch((error) => {
        console.warn('Failed to collapse docked window', error)
      })
    }, delay)
  }

  function bindDockInteractions() {
    if (!dockHandle) {
      return
    }

    dockHandle.addEventListener('mouseenter', () => {
      if (state.windowDock.state === 'collapsed') {
        void expandDockedWindow().catch((error) => {
          console.warn('Failed to expand docked window', error)
        })
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

    window.addEventListener('resize', () => {
      if (state.windowDock.transitioning || state.windowDock.state !== 'expanded') {
        return
      }

      dockResizeCooldownUntil = Date.now() + DOCK_RESIZE_SETTLE_MS
      clearDockCollapseTimer()
      if (!isPointerWithinDockSurface()) {
        scheduleDockCollapse()
      }
    })
  }

  function startDockStatePolling() {
    clearDockStatePollTimer()
    // Events are the primary source; polling only fills gaps when the bridge
    // cannot subscribe or an event was missed.
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
