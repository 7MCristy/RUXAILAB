/**
 * Configuración compartida por los proveedores de IA (Gemini, Ollama).
 * Centraliza variables de entorno y valores por defecto para que no queden
 * números mágicos repetidos en cada proveedor.
 */

export function normalizeGeminiModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return 'gemini-1.5-flash'

  const normalized = modelName.trim()

  const aliasMap = {
    'gemini-2-flash': 'gemini-2.0-flash',
    'gemini-2.0': 'gemini-2.0-flash',
    'gemini-2': 'gemini-2.0-flash',
    'gemini-3-flash': 'gemini-2.5-flash',
    'gemini-3.5-flash': 'gemini-2.5-flash',
  }

  return aliasMap[normalized.toLowerCase()] || normalized
}

export const GEMINI_API_KEY = process.env.VUE_APP_GEMINI_API_KEY
export const GEMINI_MODEL = normalizeGeminiModel(
  process.env.VUE_APP_GEMINI_MODEL || 'gemini-1.5-flash',
)
export const GEMINI_TIMEOUT = Number(
  process.env.VUE_APP_GEMINI_TIMEOUT_MS || 800000,
)
export const OLLAMA_TIMEOUT_MS = Number(
  process.env.VUE_APP_OLLAMA_TIMEOUT_MS || 800000, // 13,3 minutos: margen para varios lotes de análisis heurístico
)
export const ENABLE_WEB_RESEARCH =
  process.env.VUE_APP_ENABLE_WEB_RESEARCH !== 'false'
