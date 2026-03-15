export function createSettingsController({
  state,
  modalOverlay,
  modalKind,
  modalTitle,
  modalBody,
  modalActions,
  modalPanel,
  appShell,
  setModalFeedback,
  resetModal,
  applySettingsModalChromeOrder,
  syncSettingsMeta,
  createDetailAction,
  createTextBlock,
  saveSettingsPatch,
  renderCourses,
  invokeTauriCommand,
  pickFolderPath,
  intervalSecsToMinutes,
  intervalMinutesToSecs,
  getCourseSubdirSelectionPath,
  isPathInsideBase,
  normalizeRelativeSubdir,
  toRelativeSubdir,
  getErrorMessage,
}) {
  function createSettingsField(label, value, options = {}) {
    const field = document.createElement('label')
    field.className = 'settings-field'
    if (options.compact) {
      field.classList.add('settings-field--compact')
    }

    const title = document.createElement('span')
    title.className = 'settings-field__label'
    title.textContent = label

    const control = document.createElement('input')
    control.type = options.type || 'text'
    control.className = 'settings-field__control'
    control.value = value ?? ''
    control.placeholder = options.placeholder ?? ''
    control.disabled = Boolean(options.disabled)
    control.min = options.min ?? ''
    control.dataset.field = options.fieldName ?? ''

    field.append(title, control)
    return { field, control }
  }

  function createSettingsActionRow() {
    const row = document.createElement('div')
    row.className = 'settings-action-row'
    return row
  }

  function createSettingsToggleField(label, hint, isActive, onToggle) {
    const field = document.createElement('div')
    field.className = 'settings-field settings-field--toggle'

    const title = document.createElement('span')
    title.className = 'settings-field__label'
    title.textContent = label

    const toggle = document.createElement('button')
    toggle.className = 'settings-toggle'
    toggle.type = 'button'
    toggle.dataset.active = String(Boolean(isActive))
    const text = document.createElement('span')
    text.className = 'settings-toggle__text'

    const toggleTitle = document.createElement('span')
    toggleTitle.className = 'settings-toggle__title'
    toggleTitle.textContent = label
    text.append(toggleTitle)

    if (hint) {
      const toggleHint = document.createElement('span')
      toggleHint.className = 'settings-toggle__hint'
      toggleHint.textContent = hint
      text.append(toggleHint)
    }

    const pill = document.createElement('span')
    pill.className = 'settings-toggle__pill'
    pill.textContent = isActive ? 'ON' : 'OFF'
    toggle.append(text, pill)
    toggle.addEventListener('click', onToggle)

    field.append(title, toggle)
    return { field, toggle }
  }

  async function openCourseSubdirModal(feedbackMessage = '') {
    state.modalType = 'course-subdirs'
    resetModal()
    modalPanel.dataset.layout = 'settings'
    applySettingsModalChromeOrder()

    modalKind.textContent = 'Subdirs'
    modalTitle.textContent = '课程分目录'
    syncSettingsMeta(state.settings)

    if (!state.settings.downloadDir?.trim()) {
      setModalFeedback('请先在全局设置里配置下载目录。', 'warning')
    }

    const courses = [...(state.dashboard.courses || [])].sort((left, right) =>
      String(left.courseName || '').localeCompare(String(right.courseName || ''), 'zh-CN'),
    )
    const draftSubdirs = {
      ...(state.settings.courseDownloadSubdirs || {}),
    }

    const list = document.createElement('div')
    list.className = 'course-subdir-list'

    const persistCourseSubdirs = async (successMessage) => {
      await saveSettingsPatch(
        {
          courseDownloadSubdirs: draftSubdirs,
        },
        {
          successMessage,
          renderCoursesAfterSave: true,
        },
      )
    }

    const renderRows = () => {
      list.replaceChildren()

      if (!courses.length) {
        list.append(createTextBlock('当前没有已加载课程，无法配置课程分目录。'))
        return
      }

      courses.forEach((course) => {
        const currentValue = normalizeRelativeSubdir(draftSubdirs[course.courseId] || '')
        const row = document.createElement('section')
        row.className = 'course-subdir-row'

        const header = document.createElement('div')
        header.className = 'course-subdir-row__header'

        const title = document.createElement('h3')
        title.className = 'course-subdir-row__title'
        title.textContent = course.courseName

        const value = document.createElement('p')
        value.className = 'course-subdir-row__value'
        value.textContent = currentValue || '未设置，直接下载到主目录'

        header.append(title, value)

        const actions = document.createElement('div')
        actions.className = 'course-subdir-row__actions'

        const selectButton = createDetailAction('选择子文件夹', async () => {
          if (!state.settings.downloadDir?.trim()) {
            setModalFeedback('请先在全局设置里配置下载目录。', 'warning')
            return
          }

          try {
            const selected = await pickFolderPath(
              getCourseSubdirSelectionPath(state.settings.downloadDir, currentValue),
            )
            if (!selected) {
              return
            }

            if (!isPathInsideBase(state.settings.downloadDir, selected)) {
              setModalFeedback('课程子文件夹必须位于主下载目录之下。', 'error')
              return
            }

            draftSubdirs[course.courseId] = toRelativeSubdir(state.settings.downloadDir, selected)
            await persistCourseSubdirs('课程分目录已自动保存。')
            renderRows()
          } catch (error) {
            setModalFeedback(getErrorMessage(error), 'error')
          }
        })

        const clearButton = createDetailAction('清空', async () => {
          try {
            delete draftSubdirs[course.courseId]
            await persistCourseSubdirs('课程分目录已自动保存。')
            renderRows()
          } catch (error) {
            setModalFeedback(getErrorMessage(error), 'error')
          }
        })

        actions.append(selectButton, clearButton)
        row.append(header, actions)
        list.append(row)
      })
    }

    renderRows()
    modalBody.append(list)

    modalActions.append(
      createDetailAction('返回全局设置', () => {
        openSettingsModal()
      }),
    )

    if (feedbackMessage) {
      setModalFeedback(feedbackMessage, 'warning')
    }

    modalOverlay.hidden = false
    appShell.classList.add('app-shell--modal-open')
    state.modalOpen = true
  }

  function openSettingsModal(feedbackMessage = '') {
    state.modalType = 'settings'
    resetModal()
    modalPanel.dataset.layout = 'settings'
    applySettingsModalChromeOrder()

    modalKind.textContent = 'Settings'
    modalTitle.textContent = '应用设置'
    syncSettingsMeta(state.settings)

    const settingsForm = document.createElement('div')
    settingsForm.className = 'settings-form'

    const downloadField = createSettingsField('下载目录', state.settings.downloadDir, {
      fieldName: 'downloadDir',
      placeholder: '例如: D:\\Downloads\\UCAS Classer',
    })
    const authCheckField = createSettingsField(
      'CHECK 间隔',
      intervalSecsToMinutes(state.settings.authCheckIntervalSecs, 180),
      {
        fieldName: 'authCheckIntervalSecs',
        placeholder: '默认 3',
        type: 'number',
        min: '1',
        compact: true,
      },
    )
    const collectField = createSettingsField(
      'COLLECT 间隔',
      intervalSecsToMinutes(state.settings.collectIntervalSecs, 15),
      {
        fieldName: 'collectIntervalSecs',
        placeholder: '默认 60',
        type: 'number',
        min: '1',
        compact: true,
      },
    )
    const cookieRefreshField = createSettingsField(
      'COOKIE 刷新间隔',
      intervalSecsToMinutes(state.settings.cookieRefreshIntervalSecs, 720),
      {
        fieldName: 'cookieRefreshIntervalSecs',
        placeholder: '默认 60',
        type: 'number',
        min: '1',
        compact: true,
      },
    )

    let dockEnabled = Boolean(state.settings.enableAutoDockCollapse)
    let dockSaving = false
    const syncDockToggleUi = () => {
      dockToggleField.toggle.dataset.active = String(dockEnabled)
      dockToggleField.toggle.querySelector('.settings-toggle__pill').textContent = dockEnabled
        ? 'ON'
        : 'OFF'
    }
    const dockToggleField = createSettingsToggleField(
      '自动窗口收起',
      '窗口拖到左右边缘后自动收起，移入边缘栏再展开。',
      dockEnabled,
      async () => {
        if (dockSaving) {
          return
        }

        const previousEnabled = dockEnabled
        dockEnabled = !dockEnabled
        dockSaving = true
        dockToggleField.toggle.disabled = true
        syncDockToggleUi()

        try {
          const saved = await saveSettingsPatch(
            {
              enableAutoDockCollapse: dockEnabled,
            },
            {
              successMessage: '自动侧收设置已更新。',
              syncMeta: true,
              refreshDockStateAfterSave: true,
              afterSave: async (nextSettings) => {
                dockEnabled = Boolean(nextSettings.enableAutoDockCollapse)
                if (!dockEnabled) {
                  await invokeTauriCommand('exit_dock_mode')
                }
              },
            },
          )
          dockEnabled = Boolean(saved.enableAutoDockCollapse)
        } catch (error) {
          dockEnabled = previousEnabled
          setModalFeedback(getErrorMessage(error), 'error')
        } finally {
          dockToggleField.toggle.disabled = false
          dockSaving = false
          syncDockToggleUi()
        }
      },
    )
    dockToggleField.toggle.querySelector('.settings-toggle__hint')?.remove()

    const downloadActionRow = createSettingsActionRow()
    const pickButton = createDetailAction('选择文件夹', async () => {
      try {
        const selected = await pickFolderPath(
          downloadField.control.value.trim() || state.settings.downloadDir,
        )
        if (!selected) {
          return
        }
        downloadField.control.value = selected
      } catch (error) {
        setModalFeedback(getErrorMessage(error), 'error')
      }
    })
    const subdirButton = createDetailAction('课程分目录', () => {
      const nextDownloadDir = downloadField.control.value.trim()
      state.settings = {
        ...state.settings,
        downloadDir: nextDownloadDir || state.settings.downloadDir,
      }
      openCourseSubdirModal()
    })
    downloadActionRow.append(pickButton, subdirButton)

    const scopeField = document.createElement('div')
    scopeField.className = 'settings-field settings-field--scope'
    scopeField.append(
      Object.assign(document.createElement('span'), {
        className: 'settings-field__label',
        textContent: '课程范围',
      }),
    )

    const scopeToggle = document.createElement('div')
    scopeToggle.className = 'settings-scope-toggle'
    const scopeOptions = [
      { value: 'all', label: '全部' },
      { value: 'current', label: '当前学期' },
      { value: 'past', label: '以往学期' },
    ]
    let selectedScope = state.settings.courseScope || 'all'
    let scopeSaving = false

    const renderScopeButtons = () => {
      scopeToggle.replaceChildren()
      scopeOptions.forEach((option) => {
        const button = document.createElement('button')
        button.className = 'settings-scope-toggle__button'
        button.type = 'button'
        button.dataset.active = String(selectedScope === option.value)
        button.textContent = option.label
        button.disabled = scopeSaving
        button.addEventListener('click', async () => {
          if (scopeSaving || selectedScope === option.value) {
            return
          }

          const previousScope = state.settings.courseScope || 'all'
          selectedScope = option.value
          scopeSaving = true
          renderScopeButtons()

          try {
            const saved = await saveSettingsPatch(
              {
                courseScope: option.value,
              },
              {
                successMessage: '课程范围已更新。',
                syncMeta: true,
                renderCoursesAfterSave: true,
              },
            )
            selectedScope = saved.courseScope || option.value
          } catch (error) {
            selectedScope = previousScope
            setModalFeedback(getErrorMessage(error), 'error')
          } finally {
            scopeSaving = false
            renderScopeButtons()
          }
        })
        scopeToggle.append(button)
      })
    }

    renderScopeButtons()
    scopeField.append(scopeToggle)

    const intervalRow = document.createElement('div')
    intervalRow.className = 'settings-inline-row'
    intervalRow.append(authCheckField.field, collectField.field, cookieRefreshField.field)

    const settingsHint = document.createElement('p')
    settingsHint.className = 'settings-form__hint'
    settingsHint.textContent = '所有时间设置单位均为分钟。课程分目录会在主下载目录下生效。'

    settingsForm.append(
      downloadField.field,
      downloadActionRow,
      dockToggleField.field,
      scopeField,
      intervalRow,
    )
    modalBody.append(settingsForm, settingsHint)

    modalActions.append(
      createDetailAction(
        '保存设置',
        async () => {
          try {
            const saved = await saveSettingsPatch(
              {
                downloadDir: downloadField.control.value.trim(),
                enableAutoDockCollapse: dockEnabled,
                courseScope: state.settings.courseScope || selectedScope,
                authCheckIntervalSecs: intervalMinutesToSecs(authCheckField.control.value, 180 * 60),
                collectIntervalSecs: intervalMinutesToSecs(collectField.control.value, 15 * 60),
                cookieRefreshIntervalSecs: intervalMinutesToSecs(cookieRefreshField.control.value, 720 * 60),
              },
              {
                successMessage: '设置已保存。',
                syncMeta: true,
                renderCoursesAfterSave: true,
                refreshDockStateAfterSave: true,
                afterSave: async (nextSettings) => {
                  if (!nextSettings.enableAutoDockCollapse) {
                    await invokeTauriCommand('exit_dock_mode')
                  }
                  dockEnabled = Boolean(nextSettings.enableAutoDockCollapse)
                  selectedScope = nextSettings.courseScope || selectedScope
                },
              },
            )
            dockEnabled = Boolean(saved.enableAutoDockCollapse)
            selectedScope = saved.courseScope || selectedScope
            renderScopeButtons()
            syncDockToggleUi()
          } catch (error) {
            setModalFeedback(getErrorMessage(error), 'error')
          }
        },
        { primary: true },
      ),
    )

    if (feedbackMessage) {
      setModalFeedback(feedbackMessage, 'warning')
    }

    modalOverlay.hidden = false
    appShell.classList.add('app-shell--modal-open')
    state.modalOpen = true
  }

  return {
    openCourseSubdirModal,
    openSettingsModal,
  }
}
