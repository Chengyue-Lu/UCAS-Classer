function formatCount(value) {
  return String(Number(value) || 0).padStart(2, '0')
}

function intervalSecsToMinutes(value, fallbackMinutes) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return String(fallbackMinutes)
  }

  return String(Math.max(1, Math.round(seconds / 60)))
}

function intervalMinutesToSecs(value, fallbackSeconds) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return fallbackSeconds
  }

  return Math.max(1, Math.round(minutes)) * 60
}

function formatSettingsInterval(value, fallbackMinutes) {
  const minutes = Number(intervalSecsToMinutes(value, fallbackMinutes))
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return `${fallbackMinutes} m`
  }

  if (minutes < 60) {
    return `${minutes} m`
  }

  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '从未'
  }

  const diffMs = Math.max(0, Date.now() - timestamp)
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes <= 0) {
    return '刚刚'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} 小时前`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} 天前`
}

export {
  formatCount,
  formatRelativeTime,
  formatSettingsInterval,
  intervalMinutesToSecs,
  intervalSecsToMinutes,
}
