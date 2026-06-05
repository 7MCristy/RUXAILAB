/**
 * SERVICIO GEMINI API PARA RUIXALAB - VERSIÓN CORREGIDA
 * Archivo: src/ux/Heuristic/services/geminiReportService.js
 *
 * ✅ Gemini API como primaria
 * ✅ Ollama como fallback (CORREGIDO)
 * ✅ Usa buildOllamaRequestBody correctamente
 *
 * USO:
 * import { generateAiReportWithFallback } from '@/ux/Heuristic/services/geminiReportService'
 * const content = await generateAiReportWithFallback(finalReportItem)
 */

import {
  buildHeuristicReportPrompt,
  buildOllamaRequestBody,
  SYSTEM_PROMPT,
} from '@/ux/Heuristic/utils/aiReportPrompt'

// Configuración desde variables de entorno
const GEMINI_API_KEY = process.env.VUE_APP_GEMINI_API_KEY
const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'
const GEMINI_TIMEOUT = 30000 // 30 segundos

/**
 * Valida que la API Key esté configurada
 */
function validateApiKey() {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY no está configurada. Añade VUE_APP_GEMINI_API_KEY a tu archivo .env',
    )
  }
}

/**
 * Convierte el prompt en formato Gemini API
 */
function buildGeminiRequestBody(finalReportItem) {
  const userPrompt = buildHeuristicReportPrompt(finalReportItem)

  return {
    contents: [
      {
        parts: [
          {
            text: userPrompt,
          },
        ],
      },
    ],
    systemInstruction: {
      parts: [
        {
          text: SYSTEM_PROMPT,
        },
      ],
    },
    generationConfig: {
      temperature: 0.35,
      topP: 0.85,
      maxOutputTokens: 4000,
    },
  }
}

/**
 * Genera un informe con IA usando Gemini API
 * Compatible con la interfaz de Ollama
 *
 * @param {Object} finalReportItem - Datos del informe final
 * @returns {Promise<string>} Contenido del informe generado
 * @throws {Error} Si hay error en la API o configuración
 */
export async function generateAiReportWithGemini(finalReportItem) {
  // Validar configuración
  validateApiKey()

  if (!finalReportItem || typeof finalReportItem !== 'object') {
    throw new Error('finalReportItem debe ser un objeto JSON válido')
  }

  try {
    console.log('[Gemini] 📝 Iniciando generación de informe con Gemini API...')

    const requestBody = buildGeminiRequestBody(finalReportItem)

    const response = await fetch(GEMINI_API_URL + `?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message || `HTTP ${response.status}`
      throw new Error(`Gemini API error: ${errorMessage}`)
    }

    const data = await response.json()
    console.log('[Gemini] ✅ Respuesta recibida')

    // Extrae el contenido del informe
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!content || typeof content !== 'string') {
      throw new Error('Respuesta vacía o formato inválido de Gemini API')
    }

    console.log('[Gemini] ✅ Informe generado exitosamente')
    return content
  } catch (error) {
    console.error('[Gemini] ❌ Error al generar informe:', error.message)

    // Interpreta errores específicos
    if (error.message.includes('401') || error.message.includes('Invalid')) {
      throw new Error(
        'API Key de Gemini inválida. Verifica VUE_APP_GEMINI_API_KEY en .env',
      )
    }

    if (error.message.includes('429')) {
      throw new Error(
        'Límite de tasa de Gemini API excedido. Espera 1 minuto e intenta de nuevo.',
      )
    }

    if (error.message.includes('400')) {
      throw new Error(
        'Solicitud inválida a Gemini API. Verifica el formato de los datos.',
      )
    }

    // Re-lanza error genérico
    throw error
  }
}

/**
 * ✅ CORREGIDO: Genera informe con Ollama usando buildOllamaRequestBody
 * Ahora llama correctamente a buildOllamaRequestBody y usa fetch
 *
 * @param {Object} finalReportItem - Datos del informe
 * @param {string} ollamaUrl - URL de Ollama (default: localhost:11434)
 * @returns {Promise<string>} Contenido del informe
 */
export async function generateAiReportWithOllama(
  finalReportItem,
  ollamaUrl = 'http://localhost:11434/api/chat',
) {
  try {
    console.log('[Ollama] ⏳ Generando informe con Ollama local...')

    // ✅ CORRECCIÓN: Llamar correctamente a buildOllamaRequestBody
    const body = buildOllamaRequestBody(finalReportItem)

    console.log('[Ollama] 📤 Enviando solicitud a:', ollamaUrl)

    // ✅ CORRECCIÓN: Usar fetch como en el código original
    const response = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    // ✅ CORRECCIÓN: Verificar correctamente la respuesta
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    const content = String(data?.message?.content || '').trim()

    if (!content) {
      throw new Error('Ollama devolvió respuesta vacía')
    }

    console.log('[Ollama] ✅ Informe generado con Ollama exitosamente')
    return content
  } catch (error) {
    console.error('[Ollama] ❌ Error con Ollama:', error.message)
    throw error
  }
}

/**
 * ✅ CORREGIDO: Genera informe con estrategia de fallback
 * 1. Intenta con Gemini API
 * 2. Si falla, intenta con Ollama local
 * 3. Si ambos fallan, devuelve conclusión genérica
 *
 * @param {Object} finalReportItem - Datos del informe
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<string>} Contenido del informe
 */
export async function generateAiReportWithFallback(
  finalReportItem,
  options = {},
) {
  const {
    ollamaUrl = 'http://localhost:11434/api/chat',
    buildFallback = null,
  } = options

  // Intenta Gemini primero
  try {
    console.log('[AI] 🚀 Intentando generar informe con Gemini API...')
    const result = await generateAiReportWithGemini(finalReportItem)
    console.log('[AI] ✅ Éxito con Gemini API')
    return result
  } catch (geminiError) {
    console.warn(
      '[AI] ⚠️  Gemini falló, intentando Ollama...',
      geminiError.message,
    )

    // Fallback a Ollama
    try {
      console.log('[AI] 🔄 Generando con Ollama local...')
      const result = await generateAiReportWithOllama(
        finalReportItem,
        ollamaUrl,
      )
      console.log('[AI] ✅ Éxito con Ollama local')
      return result
    } catch (ollamaError) {
      console.error('[AI] ❌ Ambos servicios fallaron', {
        gemini: geminiError.message,
        ollama: ollamaError.message,
      })

      // Fallback final: conclusión genérica
      if (buildFallback && typeof buildFallback === 'function') {
        console.log('[AI] ✅ Usando conclusión de fallback')
        const fallbackContent = buildFallback()
        return fallbackContent
      }

      throw new Error(
        `No se pudo generar informe con IA. Gemini: ${geminiError.message}. Ollama: ${ollamaError.message}`,
      )
    }
  }
}

/**
 * Hook para usar en Vue - detecta automáticamente qué usar
 */
export async function useAiReport(finalReportItem, options = {}) {
  const useGemini = options.useGemini !== false // true por defecto
  const useFallback = options.useFallback !== false // true por defecto

  if (useGemini && GEMINI_API_KEY) {
    if (useFallback) {
      return generateAiReportWithFallback(finalReportItem, options)
    }
    return generateAiReportWithGemini(finalReportItem)
  }

  // Fallback a Ollama
  return generateAiReportWithOllama(finalReportItem, options.ollamaUrl)
}

export default {
  generateAiReportWithGemini,
  generateAiReportWithOllama,
  generateAiReportWithFallback,
  useAiReport,
  validateApiKey,
}
