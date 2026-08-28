const STORAGE_KEY = 'ruxailab_token_usage'

const LIMITS = {
  jina: { total: 10_000_000_000, resetMs: 30 * 24 * 60 * 60 * 1000 },
  gemini: { total: 10_000_000_000, resetMs: 24 * 60 * 60 * 1000 },
  tinyfish: { total: 10_000_000, resetMs: 24 * 60 * 60 * 1000 },
  ollama: { total: 10_000_000_000, resetMs: 24 * 60 * 60 * 1000 },
  readability: { total: 10_000_000_000, resetMs: 24 * 60 * 60 * 1000 }, // ← Local, sin cuota API
}

function loadUsage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    const now = Date.now()
    for (const key of Object.keys(LIMITS)) {
      if (!data[key]) continue
      const elapsed = now - (data[key].windowStart || 0)
      if (elapsed > LIMITS[key].resetMs) {
        data[key] = { used: 0, windowStart: now }
      }
    }
    return data
  } catch {
    return null
  }
}

function saveUsage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage full or unavailable
  }
}

function getUsageData() {
  return loadUsage() || {
    jina: { used: 0, windowStart: Date.now() },
    gemini: { used: 0, windowStart: Date.now() },
    tinyfish: { used: 0, windowStart: Date.now() },
    readability: { used: 0, windowStart: Date.now() },
  }
}

export function getRemaining(service) {
  const data = getUsageData()
  const limit = LIMITS[service]
  if (!limit) return { remaining: 0, total: 0, used: 0 }
  const used = data[service]?.used || 0
  return {
    remaining: Math.max(0, limit.total - used),
    total: limit.total,
    used,
  }
}

export function trackTokens(service, count) {
  if (!LIMITS[service] || count <= 0) return
  const data = getUsageData()
  if (!data[service]) {
    data[service] = { used: 0, windowStart: Date.now() }
  }
  data[service].used += count
  saveUsage(data)
}

export function hasQuota(service) {
  const { remaining } = getRemaining(service)
  return remaining > 0
}

export function resetUsage(service) {
  const data = getUsageData()
  if (service) {
    data[service] = { used: 0, windowStart: Date.now() }
  } else {
    for (const key of Object.keys(LIMITS)) {
      data[key] = { used: 0, windowStart: Date.now() }
    }
  }
  saveUsage(data)
}

export function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}
