/**
 * SERVICIO GEMINI API PARA RUIXALAB - CON LIBRERÍA OFICIAL @google/genai
 * Archivo: src/ux/Heuristic/services/geminiReportService.js
 *
 * ✅ Usa la librería oficial de Google Gemini
 * ✅ Ollama como fallback
 */

import { GoogleGenAI } from '@google/genai'
import {
  buildHeuristicReportPrompt,
  buildOllamaRequestBody,
  SYSTEM_PROMPT,
} from '@/ux/Heuristic/utils/aiReportPrompt'

// Configuración desde variables de entorno
const GEMINI_API_KEY = process.env.VUE_APP_GEMINI_API_KEY
const GEMINI_MODEL = process.env.VUE_APP_GEMINI_MODEL || 'gemini-1.5-flash'
const GEMINI_TIMEOUT = 30000 // 30 segundos

// Instancia del cliente Gemini (inicialización lazy)
let geminiClient = null

/**
 * Inicializa el cliente de Gemini con la API key
 */
function getGeminiClient() {
  if (!geminiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error(
        'GEMINI_API_KEY no está configurada. Añade VUE_APP_GEMINI_API_KEY a tu archivo .env',
      )
    }
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  }
  return geminiClient
}

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
 * Genera un informe con IA usando la librería oficial @google/genai
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
    console.log(
      '[Gemini] 📝 Iniciando generación de informe con librería oficial...',
    )
    console.log('[Gemini] Modelo:', GEMINI_MODEL)

    const client = getGeminiClient()
    const userPrompt = buildHeuristicReportPrompt(finalReportItem)

    console.log(
      '[Gemini] Prompt construido, longitud:',
      userPrompt.length,
      'caracteres',
    )

    // Configuración de la generación
    const config = {
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      config: {
        temperature: 0.35,
        topP: 0.85,
        maxOutputTokens: 4000,
        systemInstruction: SYSTEM_PROMPT,
      },
    }

    console.log('[Gemini] Enviando solicitud a Google AI Studio...')

    // Usar la librería oficial con timeout manual
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT)

    try {
      const response = await client.models.generateContent(config, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      console.log('[Gemini] ✅ Respuesta recibida')

      // Extraer el texto de la respuesta
      const content = response?.text || ''

      if (!content || typeof content !== 'string') {
        throw new Error('Respuesta vacía o formato inválido de Gemini API')
      }

      console.log(
        '[Gemini] ✅ Informe generado exitosamente, longitud:',
        content.length,
      )
      return content
    } catch (fetchError) {
      clearTimeout(timeoutId)
      throw fetchError
    }
  } catch (error) {
    console.error('[Gemini] ❌ Error al generar informe:', error.message)

    // Interpreta errores específicos
    if (error.message.includes('API key') || error.message.includes('403')) {
      throw new Error(
        'API Key de Gemini inválida. Verifica VUE_APP_GEMINI_API_KEY en .env',
      )
    }

    if (error.message.includes('429') || error.message.includes('quota')) {
      throw new Error(
        'Límite de cuota de Gemini API excedido. Espera 1 minuto e intenta de nuevo.',
      )
    }

    if (error.message.includes('404') || error.message.includes('not found')) {
      throw new Error(
        `Modelo ${GEMINI_MODEL} no encontrado. Verifica que el nombre del modelo sea correcto.`,
      )
    }

    if (error.name === 'AbortError') {
      throw new Error(`Gemini API timeout después de ${GEMINI_TIMEOUT}ms`)
    }

    // Re-lanza error genérico con más detalles
    throw new Error(`Gemini API error: ${error.message}`)
  }
}

/**
 * Genera informe con Ollama usando buildOllamaRequestBody
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

    const body = buildOllamaRequestBody(finalReportItem)

    console.log('[Ollama] 📤 Enviando solicitud a:', ollamaUrl)

    const response = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    const content = String(data?.message?.content || '').trim()

    if (!content) {
      throw new Error('Ollama devolvió respuesta vacía')
    }

    console.log('[Ollama] ✅ Informe generado exitosamente')
    return content
  } catch (error) {
    console.error('[Ollama] ❌ Error con Ollama:', error.message)
    throw error
  }
}

/**
 * Genera la conclusión de fallback (sin IA)
 */
function buildFallbackConclusionText() {
  return `El sistema presenta un nivel de cumplimiento que requiere atención en múltiples áreas. 
  
Las heurísticas con menor puntuación indican oportunidades claras de mejora en la experiencia de usuario. Se recomienda priorizar la revisión de los criterios que obtuvieron las calificaciones más bajas, ya que estos representan los mayores puntos de fricción para los usuarios.

La implementación de las mejoras sugeridas permitiría elevar significativamente la usabilidad general del sistema, reduciendo errores y aumentando la satisfacción de los usuarios en futuras iteraciones.`
}

/**
 * Genera informe con estrategia de fallback
 * 1. Intenta con Gemini API (librería oficial)
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
    skipGemini = false,
    skipOllama = false,
  } = options

  // Intenta Gemini primero (a menos que se omita)
  if (!skipGemini) {
    try {
      console.log(
        '[AI] 🚀 Intentando generar informe con Gemini API (librería oficial)...',
      )
      const result = await generateAiReportWithGemini(finalReportItem)
      console.log('[AI] ✅ Éxito con Gemini API')
      return result
    } catch (geminiError) {
      console.warn('[AI] ⚠️ Gemini falló:', geminiError.message)

      // Si no debemos intentar Ollama, lanzamos el error
      if (skipOllama) {
        throw geminiError
      }
    }
  }

  // Fallback a Ollama
  if (!skipOllama) {
    try {
      console.log('[AI] 🔄 Generando con Ollama local...')
      const result = await generateAiReportWithOllama(
        finalReportItem,
        ollamaUrl,
      )
      console.log('[AI] ✅ Éxito con Ollama local')
      return result
    } catch (ollamaError) {
      console.error('[AI] ❌ Ollama también falló:', ollamaError.message)
    }
  }

  // Fallback final: conclusión genérica
  console.log('[AI] 📝 Usando conclusión de fallback (sin IA)')
  return buildFallbackConclusionText()
}

/**
 * Hook para usar en Vue - detecta automáticamente qué usar
 */
export async function useAiReport(finalReportItem, options = {}) {
  const useGemini = options.useGemini !== false
  const useFallback = options.useFallback !== false

  if (useGemini && GEMINI_API_KEY) {
    if (useFallback) {
      return generateAiReportWithFallback(finalReportItem, options)
    }
    return generateAiReportWithGemini(finalReportItem)
  }

  // Fallback a Ollama
  return generateAiReportWithOllama(finalReportItem, options.ollamaUrl)
}

/**
 * Función para probar la conexión con Gemini
 */
export async function testGeminiConnection() {
  try {
    console.log('[Gemini Test] Probando conexión...')
    validateApiKey()

    const client = getGeminiClient()

    // Prueba simple
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Responde solo "OK" si funciona.' }] },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 10,
      },
    })

    console.log('[Gemini Test] ✅ Conexión exitosa:', response?.text)
    return { success: true, message: 'Conexión exitosa' }
  } catch (error) {
    console.error('[Gemini Test] ❌ Error de conexión:', error.message)
    return { success: false, error: error.message }
  }
}

export default {
  generateAiReportWithGemini,
  generateAiReportWithOllama,
  generateAiReportWithFallback,
  useAiReport,
  testGeminiConnection,
  validateApiKey,
}
