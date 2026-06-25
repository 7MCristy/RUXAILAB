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
const GEMINI_TIMEOUT = 45000
const ENABLE_WEB_RESEARCH = process.env.VUE_APP_ENABLE_WEB_RESEARCH !== 'false'

// Instancia del cliente Gemini (inicialización lazy)
let geminiClient = null

async function checkOllamaAvailable(url = 'http://localhost:11434') {
  try {
    const response = await fetch(`${url}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

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

    // Retry loop para errores 429/503
    const MAX_RETRIES = 2
    const RETRY_DELAY_MS = 45000

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log('[Gemini] Enviando solicitud a Google AI Studio...')
        if (attempt > 0) {
          console.log(`[Gemini] 🔄 Retry attempt ${attempt}/${MAX_RETRIES}`)
        }

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

          const content = response?.text || ''

          if (!content || typeof content !== 'string') {
            console.error('[Gemini] ❌ Respuesta inválida')
            throw new Error('Respuesta vacía o formato inválido de Gemini API')
          }

          console.log(
            '[Gemini] ✅ Informe generado exitosamente, longitud:',
            content.length,
          )
          return { content, webResearch: webResearchContent || '' }
        } catch (fetchError) {
          clearTimeout(timeoutId)

          const errMsg = fetchError?.message || ''
          if (
            errMsg.includes('message channel closed') ||
            errMsg.includes('A listener indicated an asynchronous response') ||
            errMsg.includes('Extension context invalidated')
          ) {
            console.warn('[Gemini] ⚠️ Error de extensión Chrome detectado')
            throw new Error('Error de extensión Chrome. Reintenta.')
          }

          throw fetchError
        }
      } catch (retryError) {
        const is429 =
          retryError.message.includes('429') ||
          retryError.message.includes('RESOURCE_EXHAUSTED') ||
          retryError.message.includes('quota')
        const is503 =
          retryError.message.includes('503') ||
          retryError.message.includes('UNAVAILABLE')

        if ((is429 || is503) && attempt < MAX_RETRIES) {
          const delay = is429 ? RETRY_DELAY_MS : 5000 * (attempt + 1)
          console.warn(
            `[Gemini] ⏳ Error ${is429 ? '429' : '503'}, retry ${attempt + 1}/${MAX_RETRIES} en ${delay}ms...`,
          )
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        throw retryError
      }
    }
  } catch (error) {
    console.error('[Gemini] ❌ Error al generar informe:', error.message)

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
        `Modelo ${GEMINI_MODEL} no encontrado.`,
      )
    }

    if (error.name === 'AbortError') {
      throw new Error(`Gemini API timeout después de ${GEMINI_TIMEOUT}ms`)
    }

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

    const baseUrl = ollamaUrl.replace('/api/chat', '')
    const isAvailable = await checkOllamaAvailable(baseUrl)
    if (!isAvailable) {
      console.warn('[Ollama] ⚠️ Ollama no está disponible en', baseUrl)
      throw new Error('Ollama no está disponible')
    }

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
 * Corríge los comentarios del investigador usando IA
 * @param {Object} comments - Objeto con comentarios {heuristicId: {questionId: commentText}}
 * @param {string} language - Idioma de los comentarios (es, ca, en)
 * @returns {Promise<Object>} Comentarios corregidos con la misma estructura
 */
export async function correctCommentsWithAI(comments, language = 'ca') {
  if (!comments || Object.keys(comments).length === 0) {
    return comments
  }

  try {
    console.log('[AI] Corrigiendo comentarios con IA...')
    console.log('[AI] Comentarios a corregir:', comments)
    
    const client = getGeminiClient()
    
    // Construir prompt para corregir comentarios
    const langName = language === 'ca' ? 'catalán' : language === 'es' ? 'español' : 'inglés'
    
    const commentPairs = []
    Object.entries(comments).forEach(([heuristicId, questions]) => {
      Object.entries(questions).forEach(([questionId, comment]) => {
        if (comment && String(comment).trim().length > 0) {
          commentPairs.push({
            heuristicId,
            questionId,
            original: comment
          })
        }
      })
    })
    
    if (commentPairs.length === 0) {
      return comments
    }
    
    // Procesar comentarios en grupos para no exceder el token limit
    const batchSize = 10
    const correctedComments = {}
    
    for (let i = 0; i < commentPairs.length; i += batchSize) {
      const batch = commentPairs.slice(i, i + batchSize)
      
      const prompt = `
        Eres un corrector de textos profesional. 
        CORRIGE los siguientes comentarios en ${langName}, manteniendo su significado original pero mejorando la redacción, gramática y ortografía.
        Devuelve UNICAMENTE los textos corregidos en el mismo orden, uno por línea, sin números, sin explicaciones, sin formato markdown.
        
        Textos a corregir:
        ${batch.map(c => `- ${c.original}`).join('\n')}
      `.trim()
      
      console.log('[AI] Prompt de corrección:', prompt.substring(0, 200) + '...')
      
      const config = {
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 2000,
        },
      }
      
      const response = await client.models.generateContent(config)
      const correctedText = response?.text || ''
      const correctedLines = correctedText.trim().split('\n').filter(l => l.trim().length > 0)
      
      // Asignar comentarios corregidos
      correctedLines.forEach((corrected, idx) => {
        if (batch[idx]) {
          const { heuristicId, questionId } = batch[idx]
          if (!correctedComments[heuristicId]) {
            correctedComments[heuristicId] = {}
          }
          correctedComments[heuristicId][questionId] = corrected.trim()
        }
      })
    }
    
    console.log('[AI] ✅ Comentarios corregidos:', correctedComments)
    return correctedComments
    
  } catch (error) {
    console.error('[AI] ❌ Error corrigiendo comentarios:', error.message)
    console.warn('[AI] Devolviendo comentarios originales sin corregir')
    return comments
  }
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
  correctCommentsWithAI,
}
