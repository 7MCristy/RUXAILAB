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
import { researchWebsite } from './webSearchService'

// Configuración desde variables de entorno
const GEMINI_API_KEY = process.env.VUE_APP_GEMINI_API_KEY
const GEMINI_MODEL = process.env.VUE_APP_GEMINI_MODEL || 'gemini-1.5-flash'
const GEMINI_TIMEOUT = 30000 // 30 segundos
const ENABLE_WEB_RESEARCH = process.env.VUE_APP_ENABLE_WEB_RESEARCH !== 'false'

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
 * @returns {Promise<{content: string, webResearch: string}>} Contenido del informe y datos de investigación web
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
    console.log('[Gemini] Datos recibidos en finalReportItem:', {
      titulo: finalReportItem.title,
      url: finalReportItem.testUrl,
      heuristicas: finalReportItem.statisticsByHeuristics?.items?.length || 0,
      evaluadores: finalReportItem.statisticsTable?.items?.length || 0,
      respuestas: finalReportItem.allAnswers?.length || 0,
      preguntasEstructura: finalReportItem.testStructure?.length || 0,
      cumplimientoGlobal: finalReportItem.generalStatistics?.average,
      tieneComentarios: Object.keys(finalReportItem.heuristicComments || {}).length > 0,
    })

    // Investigación web RAG: buscar información actualizada del sitio evaluado
    let webResearchContent = ''
    if (ENABLE_WEB_RESEARCH) {
      try {
        console.log('[Gemini] 🌐 Iniciando investigación web (RAG)...')
        const webResult = await researchWebsite({
          testUrl: finalReportItem.testUrl,
          testDescription: finalReportItem.testDescription,
          testTitle: finalReportItem.title,
        })
        webResearchContent = webResult.content
        console.log('[Gemini] 🌐 Investigación web obtenida, fuente:', webResult.source, 'longitud:', webResearchContent.length)
      } catch (webError) {
        console.warn('[Gemini] ⚠️ Investigación web falló (continuando sin ella):', webError.message)
      }
    } else {
      console.log('[Gemini] 🌐 Investigación web deshabilitada (VUE_APP_ENABLE_WEB_RESEARCH=false)')
    }

    const client = getGeminiClient()
    const userPrompt = buildHeuristicReportPrompt(finalReportItem, webResearchContent)

    console.log(
      '[Gemini] Prompt construido, longitud:',
      userPrompt.length,
      'caracteres',
    )
    console.log('[Gemini] Inicio del prompt (primeros 300 chars):', userPrompt.substring(0, 300))
    console.log('[Gemini] Final del prompt (últimos 300 chars):', userPrompt.substring(userPrompt.length - 300))

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
    console.log('[Gemini] Configuración:', {
      model: GEMINI_MODEL,
      temperature: 0.35,
      maxOutputTokens: 4000,
      timeout: GEMINI_TIMEOUT + 'ms',
    })

    // Usar la librería oficial con timeout manual
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      console.warn('[Gemini] ⏱️ Timeout alcanzado, abortando solicitud...')
      controller.abort()
    }, GEMINI_TIMEOUT)

    try {
      const response = await client.models.generateContent(config, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      console.log('[Gemini] ✅ Respuesta recibida')

      // Extraer el texto de la respuesta
      const content = response?.text || ''

      console.log('[Gemini] 🔍 Estructura de respuesta completa:', {
        tieneTexto: !!response?.text,
        tipoTexto: typeof response?.text,
        tieneCandidates: Array.isArray(response?.candidates),
        cantidadCandidates: response?.candidates?.length || 0,
      })

      if (!content || typeof content !== 'string') {
        console.error('[Gemini] ❌ Respuesta inválida - content:', typeof content, 'valor:', JSON.stringify(content).substring(0, 200))
        throw new Error('Respuesta vacía o formato inválido de Gemini API')
      }

      console.log(
        '[Gemini] ✅ Informe generado exitosamente, longitud:',
        content.length,
        'caracteres',
      )
      console.log('[Gemini] 📄 Preview del informe (primeros 200 chars):', content.substring(0, 200))
      return { content, webResearch: webResearchContent || '' }
    } catch (fetchError) {
      clearTimeout(timeoutId)
      console.error('[Gemini] ❌ Error en la solicitud fetch:', {
        nombre: fetchError.name,
        mensaje: fetchError.message,
        tipo: typeof fetchError,
      })

      // Detecta errores de extensión de Chrome (no son errores reales de la app)
      const errMsg = fetchError?.message || ''
      if (
        errMsg.includes('message channel closed') ||
        errMsg.includes('A listener indicated an asynchronous response') ||
        errMsg.includes('Extension context invalidated')
      ) {
        console.warn('[Gemini] ⚠️ Error de extensión Chrome detectado, ignorando...')
        throw new Error('Error de comunicación con extensión de Chrome. Reintenta la operación.')
      }

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
    return { content, webResearch: '' }
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
    buildFallback,
  } = options

  console.log('[AI] ===== INICIO GENERACIÓN INFORME CON IA =====')
  console.log('[AI] Opciones:', { skipGemini, skipOllama, ollamaUrl })
  console.log('[AI] Resumen datos entrada:', {
    titulo: finalReportItem?.title,
    heuristicas: finalReportItem?.statisticsByHeuristics?.items?.length || 0,
    evaluadores: finalReportItem?.statisticsTable?.items?.length || 0,
    respuestas: finalReportItem?.allAnswers?.length || 0,
    cumplimientoGlobal: finalReportItem?.generalStatistics?.average,
  })

  // Intenta Gemini primero (a menos que se omita)
  if (!skipGemini) {
    try {
      console.log(
        '[AI] 🚀 Intentando generar informe con Gemini API (librería oficial)...',
      )
      const result = await generateAiReportWithGemini(finalReportItem)
      console.log('[AI] ✅ Éxito con Gemini API')
      console.log('[AI] ===== FIN GENERACIÓN (Gemini) =====')
      // Normalize result format
      if (typeof result === 'string') {
        return { content: result, webResearch: '' }
      }
      return result
    } catch (geminiError) {
      console.warn('[AI] ⚠️ Gemini falló:', geminiError.message)
      console.warn('[AI] ⚠️ Stack:', geminiError.stack?.substring(0, 300))

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
      console.log('[AI] ===== FIN GENERACIÓN (Ollama) =====')
      // Normalize result format
      if (typeof result === 'string') {
        return { content: result, webResearch: '' }
      }
      return result
    } catch (ollamaError) {
      console.error('[AI] ❌ Ollama también falló:', ollamaError.message)
      console.error('[AI] ❌ Stack:', ollamaError.stack?.substring(0, 300))
    }
  }

  // Fallback final: conclusión genérica o personalizada
  console.log('[AI] 📝 Usando conclusión de fallback (sin IA)')
  console.log('[AI] ⚠️ AMBAS IAs fallaron. Usando texto de respaldo.')
  console.log('[AI] ===== FIN GENERACIÓN (Fallback) =====')
  const fallbackText = typeof buildFallback === 'function'
    ? buildFallback()
    : buildFallbackConclusionText()
  return { content: fallbackText, webResearch: '' }
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
