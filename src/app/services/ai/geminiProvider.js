/**
 * Proveedor Gemini — todo lo específico de la API oficial de Google
 * (@google/genai): cliente, esquema JSON forzado, llamada con reintentos,
 * y las dos utilidades de IA que usan directamente el cliente de Gemini
 * (corrección de comentarios, test de conexión).
 */

import { GoogleGenAI, Type } from '@google/genai'
import {
  buildHeuristicReportPrompt,
  SYSTEM_PROMPT,
} from '@/ux/Heuristic/utils/aiReportPrompt'
import { researchWebsite } from '../webSearchService'
import {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_TIMEOUT,
  ENABLE_WEB_RESEARCH,
} from './aiConfig'
import { cleanSectionText, parseHeuristicAnalysis } from './aiReportParsers'

export const PROVIDER_NAME = 'gemini'

// Instancia del cliente Gemini (inicialización lazy)
let geminiClient = null

/**
 * Esquema de salida forzado para Gemini (responseSchema + responseMimeType:
 * 'application/json'). Con esto la API garantiza a nivel de servidor que la
 * respuesta es un JSON válido con estas claves exactas — ya no dependemos
 * de que el modelo repita literalmente marcadores de texto libre
 * (===SECCION:X=== o ## Headers), que es donde fallaba el parseo anterior.
 */
const REPORT_JSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    introduccion: {
      type: Type.STRING,
      description:
        'Introducción del informe: 5-7 párrafos en prosa continua y tono formal, sin resultados ni porcentajes todavía. Ver instrucciones detalladas en el prompt.',
    },
    porcentajes: {
      type: Type.STRING,
      description:
        'Único párrafo denso (6-8 frases) que sintetiza el cumplimiento global y la madurez UX del sistema. Ver instrucciones detalladas en el prompt.',
    },
    tipos_respuesta: {
      type: Type.STRING,
      description:
        'Párrafo breve (2-3 frases) sobre los tipos de respuesta usados. Cadena vacía si no hay datos de tipos de respuesta.',
    },
    analisis_heuristico: {
      type: Type.STRING,
      description:
        'Análisis detallado por heurística, EXACTAMENTE con el formato de bloques H{numero}/[ESTADO_ACTUAL]/[IMPACTO_NEGATIVO]/[PROPUESTAS_DE_MEJORA]/[RESUMEN_EJECUTIVO] descrito en el prompt.',
    },
    comparativa: {
      type: Type.STRING,
      description:
        'Comparativa de puntuaciones entre evaluadores: consenso, dispersión y validez del estudio. Ver instrucciones detalladas en el prompt.',
    },
    conclusion: {
      type: Type.STRING,
      description:
        'Conclusión final del informe (8-12 frases): síntesis, hallazgos, potencial, roadmap y cierre, en narrativa continua sin viñetas ni etiquetas de subapartado.',
    },
  },
  required: [
    'introduccion',
    'porcentajes',
    'analisis_heuristico',
    'comparativa',
    'conclusion',
  ],
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

export function isGeminiConfigured() {
  return Boolean(GEMINI_API_KEY)
}

/**
 * Repara una respuesta JSON incompleta (típicamente truncada por
 * maxOutputTokens antes de cerrar el objeto). Extrae cada clave conocida
 * directamente por regex en vez de recurrir al parser de texto libre, que
 * busca marcadores (===SECCION:X===) que el prompt en modo JSON ya no
 * genera — usarlo aquí solo produciría basura (fragmentos de JSON mal
 * interpretados como prosa). Si el valor de una clave quedó cortado a
 * mitad (sin comilla de cierre), se recupera lo que haya hasta el corte en
 * vez de perder la clave entera.
 */
function repairTruncatedGeminiJson(content) {
  const KEYS = [
    'introduccion',
    'porcentajes',
    'tipos_respuesta',
    'analisis_heuristico',
    'comparativa',
    'conclusion',
  ]
  const parsed = {}
  for (const key of KEYS) {
    const closedRegex = new RegExp(
      `"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
      's',
    )
    const closedMatch = content.match(closedRegex)
    let raw = closedMatch ? closedMatch[1] : null
    if (raw == null) {
      // El valor quedó truncado antes de la comilla de cierre: toma todo
      // lo que haya desde la apertura hasta el final del texto recibido.
      const openRegex = new RegExp(
        `"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)$`,
        's',
      )
      const openMatch = content.match(openRegex)
      raw = openMatch ? openMatch[1] : ''
    }
    // El fragmento capturado sigue escapado como JSON (\n, \", etc.) —
    // reutiliza JSON.parse para desescaparlo; si el propio fragmento
    // termina a mitad de una secuencia de escape, cae al texto crudo.
    try {
      parsed[key] = JSON.parse(`"${raw}"`)
    } catch {
      parsed[key] = raw
    }
  }
  return parsed
}

/**
 * Parsea la respuesta JSON forzada de Gemini (responseSchema) en las 6
 * secciones del informe. Como el esquema garantiza JSON válido con las
 * claves correctas, esto reemplaza la cascada frágil de parseo de texto
 * libre para el camino de Gemini.
 * @param {string} content - Texto crudo devuelto por Gemini
 * @returns {Object} Secciones: { introduccion, porcentajes, tipos_respuesta, analisis_heuristico, analisis_heuristico_blocks, comparativa, conclusion }
 */
function parseGeminiJsonSections(content) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (jsonError) {
    console.warn(
      '[Gemini] ⚠️ JSON incompleto/inválido pese a responseSchema (probable corte por límite de tokens), reparando por clave:',
      jsonError.message,
    )
    parsed = repairTruncatedGeminiJson(content)
  }

  const sections = {
    introduccion: cleanSectionText(parsed?.introduccion || ''),
    porcentajes: cleanSectionText(parsed?.porcentajes || ''),
    tipos_respuesta: cleanSectionText(parsed?.tipos_respuesta || ''),
    analisis_heuristico: cleanSectionText(parsed?.analisis_heuristico || ''),
    comparativa: cleanSectionText(parsed?.comparativa || ''),
    conclusion: cleanSectionText(parsed?.conclusion || ''),
  }
  sections.analisis_heuristico_blocks = parseHeuristicAnalysis(
    parsed?.analisis_heuristico || '',
  )

  console.log('[Gemini] 📊 Secciones JSON parseadas:', {
    introduccion: sections.introduccion.length,
    porcentajes: sections.porcentajes.length,
    tipos_respuesta: sections.tipos_respuesta.length,
    analisis_heuristico: sections.analisis_heuristico.length,
    analisis_heuristico_blocks: sections.analisis_heuristico_blocks.length,
    comparativa: sections.comparativa.length,
    conclusion: sections.conclusion.length,
  })

  return sections
}

/**
 * Genera un informe con IA usando la librería oficial @google/genai
 *
 * @param {Object} finalReportItem - Datos del informe final
 * @returns {Promise<{content: string, webResearch: string, userPrompt: string, sections: Object}>}
 * @throws {Error} Si hay error en la API o configuración
 */
export async function generateAiReportWithGemini(finalReportItem) {
  // Validar configuración
  validateApiKey()

  if (!finalReportItem || typeof finalReportItem !== 'object') {
    throw new Error('finalReportItem debe ser un objeto JSON válido')
  }

  try {
    console.log('[Gemini] Iniciando generación de informe...')
    console.log('[Gemini] Configuración del modelo:', {
      model: GEMINI_MODEL,
      timeoutMs: GEMINI_TIMEOUT,
      maxOutputTokens: 16384,
      enableWebResearch: ENABLE_WEB_RESEARCH,
      hasApiKey: Boolean(GEMINI_API_KEY),
    })

    // Investigación web RAG: buscar información actualizada del sitio evaluado
    let webResearchContent = ''
    if (ENABLE_WEB_RESEARCH) {
      try {
        const webResult = await researchWebsite({
          testUrl: finalReportItem.testUrl,
          testDescription: finalReportItem.testDescription,
          testTitle: finalReportItem.title,
        })
        webResearchContent = webResult.content
      } catch (webError) {
        console.warn('[Gemini] Investigación web falló:', webError.message)
      }
    }

    const client = getGeminiClient()
    const userPrompt = buildHeuristicReportPrompt(
      finalReportItem,
      webResearchContent,
      { format: 'json' },
    )

    // Configuración de la generación. responseMimeType + responseSchema
    // fuerzan a la API a devolver JSON válido con estas claves exactas
    // (constrained decoding a nivel de servidor) — así el parseo posterior
    // ya no depende de que el modelo repita marcadores de texto libre.
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
        maxOutputTokens: 40384,
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: REPORT_JSON_SCHEMA,
      },
    }

    // Retry loop para errores 429/503
    const MAX_RETRIES = 2
    const RETRY_DELAY_MS = 45000

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          controller.abort()
        }, GEMINI_TIMEOUT)

        try {
          const response = await client.models.generateContent(config, {
            signal: controller.signal,
          })

          clearTimeout(timeoutId)

          const content = response?.text || ''

          if (!content || typeof content !== 'string') {
            throw new Error('Respuesta vacía o formato inválido de Gemini API')
          }

          console.log('[Gemini] 🧾 Respuesta recibida:', {
            length: content.length,
            approxTokens: Math.ceil(content.length / 3.5),
            preview: content.slice(0, 400),
          })

          const sections = parseGeminiJsonSections(content)

          return {
            content,
            webResearch: webResearchContent || '',
            userPrompt,
            sections,
          }
        } catch (fetchError) {
          clearTimeout(timeoutId)

          const errMsg = fetchError?.message || ''
          if (
            errMsg.includes('message channel closed') ||
            errMsg.includes('A listener indicated an asynchronous response') ||
            errMsg.includes('Extension context invalidated')
          ) {
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
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        throw retryError
      }
    }
  } catch (error) {
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
      throw new Error(`Modelo ${GEMINI_MODEL} no encontrado.`)
    }

    if (error.name === 'AbortError') {
      throw new Error(`Gemini API timeout después de ${GEMINI_TIMEOUT}ms`)
    }

    throw new Error(`Gemini API error: ${error.message}`)
  }
}

/**
 * Corrige los comentarios del investigador usando IA
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
    const langName =
      language === 'ca' ? 'catalán' : language === 'es' ? 'español' : 'inglés'

    const commentPairs = []
    Object.entries(comments).forEach(([heuristicId, questions]) => {
      Object.entries(questions).forEach(([questionId, comment]) => {
        if (comment && String(comment).trim().length > 0) {
          commentPairs.push({
            heuristicId,
            questionId,
            original: comment,
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
        ${batch.map((c) => `- ${c.original}`).join('\n')}
      `.trim()

      console.log(
        '[AI] Prompt de corrección:',
        prompt.substring(0, 200) + '...',
      )

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
      const correctedLines = correctedText
        .trim()
        .split('\n')
        .filter((l) => l.trim().length > 0)

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

export { validateApiKey }
