/**
 * SERVICIO GEMINI API PARA RUIXALAB - CON LIBRERÍA OFICIAL @google/genai
 * Archivo: src/ux/Heuristic/services/geminiReportService.js
 *
 * ✅ Usa la librería oficial de Google Gemini
 * ✅ Ollama como fallback
 */

import { GoogleGenAI, Type } from '@google/genai'
import {
  buildHeuristicReportPrompt,
  SYSTEM_PROMPT,
} from '@/ux/Heuristic/utils/aiReportPrompt'
import {
  buildOllamaPlan,
  assembleOllamaReport,
} from '@/ux/Heuristic/utils/aiReportPromptOllama'
import { researchWebsite } from './webSearchService'
import {
  hasQuota,
  trackTokens,
  estimateTokens,
  getRemaining,
} from './tokenTracker'

// Configuración desde variables de entorno
const GEMINI_API_KEY = process.env.VUE_APP_GEMINI_API_KEY
const GEMINI_MODEL = process.env.VUE_APP_GEMINI_MODEL || 'gemini-1.5-flash'
const GEMINI_TIMEOUT = 150000
const ENABLE_WEB_RESEARCH = process.env.VUE_APP_ENABLE_WEB_RESEARCH !== 'false'

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

async function checkOllamaAvailable(
  tagsUrl = 'http://localhost:11434/api/tags',
) {
  const startedAt = Date.now()

  try {
    console.log('[Ollama] Comprobando disponibilidad:', tagsUrl)
    const response = await fetch(tagsUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })

    console.log('[Ollama] Disponibilidad HTTP:', {
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    })
    return response.ok
  } catch (error) {
    console.error('[Ollama] No se pudo consultar /api/tags:', {
      url: tagsUrl,
      name: error?.name,
      message: error?.message,
      durationMs: Date.now() - startedAt,
    })
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
    console.log('[Gemini] Iniciando generación de informe...')
    console.log('[Gemini] Configuración del modelo:', {
      model: GEMINI_MODEL,
      timeoutMs: GEMINI_TIMEOUT,
      maxOutputTokens: 9500,
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
        maxOutputTokens: 9500,
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
 * Parsea la respuesta JSON forzada de Gemini (responseSchema) en las 6
 * secciones del informe. Como el esquema garantiza JSON válido con las
 * claves correctas, esto reemplaza la cascada frágil de
 * parseAiReportSections (marcadores de texto / headers / keywords) para el
 * camino de Gemini. Si por algún motivo el contenido no fuese JSON válido
 * (nunca debería pasar con responseSchema, pero se cubre por seguridad),
 * recurre a parseAiReportSections sobre el texto crudo.
 * @param {string} content - Texto crudo devuelto por Gemini
 * @returns {Object} Secciones: { introduccion, porcentajes, tipos_respuesta, analisis_heuristico, analisis_heuristico_blocks, comparativa, conclusion }
 */
function parseGeminiJsonSections(content) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (jsonError) {
    console.error(
      '[Gemini] ❌ La respuesta no es JSON válido pese a responseSchema, usando fallback de texto libre:',
      jsonError.message,
    )
    return parseAiReportSections(content)
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
 * Genera informe con Ollama usando múltiples llamadas pequeñas.
 *
 * Arquitectura:
 * - Llamada 1: Introducción + Porcentajes (con web research si disponible)
 * - Llamada 2+: Análisis heurístico por lotes (JSON forzado)
 * - Última llamada: Conclusión (con web research ya obtenido)
 *
 * @param {Object} finalReportItem - Datos del informe
 * @param {string} ollamaUrl - URL de Ollama (default: localhost:11434)
 * @returns {Promise<Object>} { content, sections, webResearch, source }
 */
const generateAiReportWithOllama = async function (
  finalReportItem,
  ollamaUrl = process.env.VUE_APP_OLLAMA_API_URL ||
    'http://localhost:11434/api/chat',
) {
  try {
    const model = process.env.VUE_APP_OLLAMA_MODEL || 'qwen2.5:3b'

    console.log('[Ollama] Inicio de generación:', {
      url: ollamaUrl,
      model,
    })

    // Verificar disponibilidad usando la URL directa de /api/tags
    // Construir URL de tags a partir de la URL base (sin /api/chat)
    const baseUrl = ollamaUrl.replace(/\/api\/chat\/?$/, '')
    const tagsUrl = `${baseUrl}/api/tags`

    const isAvailable = await checkOllamaAvailable(tagsUrl)
    if (!isAvailable) {
      throw new Error('Ollama no está disponible')
    }

    // Investigación web RAG
    let webResearchContent = ''
    if (ENABLE_WEB_RESEARCH) {
      try {
        console.log('[Ollama] 🌐 Iniciando investigación web...')
        const webResult = await researchWebsite({
          testUrl: finalReportItem.testUrl,
          testDescription: finalReportItem.testDescription,
          testTitle: finalReportItem.title,
        })
        webResearchContent = webResult.content
        console.log('[Ollama] ✅ Investigación web completada:', {
          source: webResult.source,
          contentLength: webResearchContent.length,
        })
      } catch (webError) {
        console.warn('[Ollama] ⚠️ Investigación web falló:', webError.message)
      }
    } else {
      console.log('[Ollama] ⚠️ Investigación web deshabilitada')
    }

    // Construir plan (múltiples llamadas)
    const plan = buildOllamaPlan(finalReportItem, model, webResearchContent)
    console.log('[Ollama] 📋 Plan:', {
      totalCalls: plan.calls.length,
      calls: plan.calls.map((c) => c.key),
      meta: plan.meta,
      timeoutMs: OLLAMA_TIMEOUT_MS,
    })

    // ─── Ejecutar llamadas en paralelo (máx 3 concurrentes) ──────────────
    const OLLAMA_TIMEOUT_MS = Number(
      process.env.VUE_APP_OLLAMA_TIMEOUT_MS || 300000, // 5 minutos
    )
    const MAX_CONCURRENT = 3
    const MAX_ATTEMPTS = 2
    const results = {}
    const startedAt = Date.now()

    console.log('[Ollama] 🔧 Config:', {
      timeout: OLLAMA_TIMEOUT_MS,
      maxConcurrent: MAX_CONCURRENT,
      maxAttempts: MAX_ATTEMPTS,
    })

    async function callOllamaOnce(call, workerId) {
      console.log(
        `[Ollama] 🌐 Worker ${workerId} → ${call.key}: Iniciando fetch...`,
      )
      const fetchStarted = Date.now()

      const response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(call.requestBody),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      })

      console.log(
        `[Ollama] 🌐 Worker ${workerId} → ${call.key}: HTTP ${response.status} (${Date.now() - fetchStarted}ms)`,
      )

      if (!response.ok) {
        const errorBody = (await response.text()).slice(0, 300)
        throw new Error(`HTTP ${response.status}: ${errorBody}`)
      }

      console.log(
        `[Ollama] 🌐 Worker ${workerId} → ${call.key}: Parseando JSON...`,
      )
      const data = await response.json()

      console.log(
        `[Ollama] 🌐 Worker ${workerId} → ${call.key}: done=${data?.done}, eval_count=${data?.eval_count}`,
      )

      const content = String(data?.message?.content || '').trim()
      console.log(
        `[Ollama] 🌐 Worker ${workerId} → ${call.key}: contenido extraído = ${content.length} chars`,
      )

      if (!content) throw new Error('Respuesta vacía del modelo')
      return content
    }

    async function callWithRetry(call, workerId) {
      const taskIndex = plan.calls.findIndex((c) => c.key === call.key)
      console.log(
        `[Ollama] 📌 Worker ${workerId} tomó tarea ${taskIndex + 1}/${plan.calls.length}: ${call.key}`,
      )

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          console.log(
            `[Ollama] ⏱️ Worker ${workerId} → ${call.key}: intento ${attempt}/${MAX_ATTEMPTS}...`,
          )
          const content = await callOllamaOnce(call, workerId)
          console.log(
            `[Ollama] ✅ Worker ${workerId} → ${call.key}: ÉXITO (intento ${attempt})`,
          )
          return { key: call.key, content, error: null }
        } catch (err) {
          console.warn(
            `[Ollama] ⚠️ Worker ${workerId} → ${call.key}: FALLO intento ${attempt}/${MAX_ATTEMPTS}:`,
            err.message,
          )
          if (attempt < MAX_ATTEMPTS) {
            const waitMs = 2000 * attempt
            console.log(
              `[Ollama] ⏳ Worker ${workerId} → ${call.key}: Esperando ${waitMs}ms antes de reintentar...`,
            )
            await new Promise((r) => setTimeout(r, waitMs))
          }
        }
      }
      console.error(
        `[Ollama] ❌ Worker ${workerId} → ${call.key}: AGOTÓ TODOS LOS REINTENTOS`,
      )
      return {
        key: call.key,
        content: null,
        error: 'Todos los reintentos fallaron',
      }
    }

    // Lanzar todas las tareas en paralelo con concurrencia limitada
    const tasks = plan.calls.map((call) => () => callWithRetry(call, 0))
    let cursor = 0

    console.log('[Ollama] 🚀 Lanzando workers:', {
      totalTasks: tasks.length,
      workers: Math.min(MAX_CONCURRENT, tasks.length),
    })

    async function worker(workerId) {
      console.log(`[Ollama] 👷 Worker ${workerId} iniciado`)
      while (cursor < tasks.length) {
        const i = cursor++
        console.log(
          `[Ollama] 👷 Worker ${workerId}: procesando tarea ${i + 1}/${tasks.length}`,
        )
        const result = await tasks[i]()
        results[result.key] = result.content
        console.log(
          `[Ollama] 👷 Worker ${workerId}: tarea ${i + 1} guardada en results["${result.key}"] = ${result.content ? result.content.length + ' chars' : 'NULL'}`,
        )
      }
      console.log(
        `[Ollama] 👷 Worker ${workerId}: no hay más tareas, terminando`,
      )
    }

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, tasks.length) }, (_, i) =>
        worker(i),
      ),
    )

    console.log(
      '[Ollama] 🔍 Todos los workers terminaron. Results keys:',
      Object.keys(results),
    )

    const exitosas = Object.values(results).filter(Boolean).length
    const fallidas = Object.values(results).filter((v) => v === null).length
    console.log('[Ollama] 📊 Resumen ejecución:', {
      total: plan.calls.length,
      exitosas,
      fallidas,
      totalDurationMs: Date.now() - startedAt,
    })

    for (const call of plan.calls) {
      const val = results[call.key]
      console.log(
        `[Ollama] 📋 result["${call.key}"] = ${val ? `${val.length} chars` : 'NULL'}`,
      )
    }

    if (fallidas > 0) {
      const fallidasKeys = plan.calls
        .filter((c) => !results[c.key])
        .map((c) => c.key)
        .join(', ')
      throw new Error(
        `Faltan respuestas de Ollama (${fallidas}/${plan.calls.length}): ${fallidasKeys}. No se puede generar el PDF incompleto.`,
      )
    }

    if (exitosas === 0) {
      throw new Error('Todas las llamadas a Ollama fallaron')
    }

    console.log('[Ollama] 🏗️ Iniciando ensamblaje...')
    console.log('[Ollama] 🏗️ Results antes de ensamblar:', {
      intro_porcentajes: results.intro_porcentajes ? 'OK' : 'NULL',
      analisis_lotes: plan.calls
        .filter((c) => c.key.startsWith('analisis_lote_'))
        .map((c) => `${c.key}: ${results[c.key] ? 'OK' : 'NULL'}`)
        .join(', '),
      conclusion: results.conclusion ? 'OK' : 'NULL',
    })

    const assembled = assembleOllamaReport(
      results,
      plan.meta.sortedByImpact || [],
    )

    console.log('[Ollama] 📊 Ensamblaje completado:', {
      introduccion: assembled.introduccion.length,
      porcentajes: assembled.porcentajes.length,
      tipos_respuesta: assembled.tipos_respuesta.length,
      analisisBlocks: assembled.analisis_heuristico_blocks.length,
      comparativa: assembled.comparativa.length,
      conclusion: assembled.conclusion.length,
      totalDurationMs: Date.now() - startedAt,
    })

    const fullContent = [
      assembled.introduccion,
      assembled.porcentajes,
      assembled.tipos_respuesta,
      assembled.analisis_heuristico,
      assembled.comparativa,
      assembled.conclusion,
    ]
      .filter(Boolean)
      .join('\n\n')

    console.log('[Ollama] 🧾 Texto final ensamblado:', {
      totalChars: fullContent.length,
      approxTokens: Math.ceil(fullContent.length / 3.5),
      sections: {
        introduccion: assembled.introduccion.length,
        porcentajes: assembled.porcentajes.length,
        tipos_respuesta: assembled.tipos_respuesta.length,
        analisis_heuristico: assembled.analisis_heuristico.length,
        comparativa: assembled.comparativa.length,
        conclusion: assembled.conclusion.length,
      },
      preview: {
        introduccion: assembled.introduccion.slice(0, 220),
        conclusion: assembled.conclusion.slice(0, 220),
      },
    })

    return {
      content: fullContent,
      sections: assembled,
      webResearch: webResearchContent,
      source: 'ollama',
    }
  } catch (error) {
    throw error
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS: Parseo de respuesta IA en secciones
// ════════════════════════════════════════════════════════════════════════════════

function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\[([^\]]+)\]$/gm, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanSectionText(text) {
  if (!text || typeof text !== 'string') return ''
  const original = text
  const cleaned = stripMarkdown(text)
    // Limpiar delimitadores ===SECCION:XXX===
    .replace(/={3,}SECCION:\w+={3,}/gi, '')
    // Limpiar títulos residuales de sección (SECCION: XXX sin ===)
    // OJO: [ \t]* y no \s*, que se comería la línea en blanco anterior y
    // fusionaría dos párrafos en uno al eliminar la línea de título.
    .replace(/^[ \t]*SECCION:\s*.+$/gim, '')
    // Limpiar headers markdown ## Titulo
    .replace(/^##\s+.+$/gm, '')
    // Limpiar títulos numerados "1. Introducción", "2. Porcentajes", etc.
    .replace(
      /^\d+\.\s+(?:Introducción|Porcentajes|Tipos de respuesta|Análisis|Comparativa|Conclusión).*/gim,
      '',
    )
    // Limpiar títulos TODO CAPS que son de sección
    .replace(
      /^(?:INTRODUCCIÓN|PORCENTAJES|TIPOS DE RESPUESTA|ANÁLISIS HEURÍSTICO|COMPARATIVA|CONCLUSION|CIERRE)[\s:]*$/gim,
      '',
    )
    // Limpiar títulos con guiones "— Titulo —"
    .replace(
      /^[-—]\s+(?:Introducción|Porcentajes|Tipos|Análisis|Comparativa|Conclusión|Cierre).+[-—]\s*$/gim,
      '',
    )
    // Limpiar etiquetas de subapartado de la conclusión que el modelo repite literalmente
    .replace(
      /^[ \t]*(?:\d+\.\s*)?(?:Síntesis|Hallazgos|Potencial|Roadmap|Cierre)\s*:\s*/gim,
      '',
    )
    // NO eliminar [ESTADO_ACTUAL], [IMPACTO_NEGATIVO], etc. — los usa parseHeuristicAnalysis
    // Limpiar líneas vacías múltiples
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  console.log(
    `[cleanSectionText] Original: ${original.length} chars → Limpio: ${cleaned.length} chars`,
  )
  return cleaned
}

/**
 * Limpia residuos de instrucciones de formato que el modelo de IA copia textualmente.
 * Elimina indicadores de longitud como "(1-2 frases)", "(2 recomendaciones...)", etc.
 * @param {string} text - Texto generado por la IA
 * @returns {string} Texto limpio
 */
function cleanAiOutput(text) {
  if (!text || typeof text !== 'string') return text
  return (
    text
      // Eliminar cualquier cosa entre paréntesis que contenga palabras clave de formato
      .replace(
        /\([^)]*\b(frases?|recomendaciones?|oraciones?|bloques?|párrafos?)\b[^)]*\)/gi,
        '',
      )
      // Eliminar residual de etiquetas de ejemplo: [PROPUESTASDEMEJORA], [IMPACTONEGATIVO], etc.
      .replace(/\[PROPUESTASDE?MEJORA\]/gi, '')
      .replace(/\[IMPACTO?NEGATIVO\]/gi, '')
      .replace(/\[ESTADOACTUAL\]/gi, '')
      .replace(/\[RESUMENEJECUTIVO\]/gi, '')
      // Eliminar etiquetas válidas sueltas en líneas propias (sin contenido después)
      .replace(/^\s*\[ESTADO_ACTUAL\]\s*$/gm, '')
      .replace(/^\s*\[IMPACTO_NEGATIVO\]\s*$/gm, '')
      .replace(/^\s*\[PROPUESTAS_DE_MEJORA\]\s*$/gm, '')
      .replace(/^\s*\[RESUMEN_EJECUTIVO\]\s*$/gm, '')
      // Eliminar líneas que son solo instrucciones del prompt
      .replace(/^\s*Aquí va\s*/gim, '')
      .replace(/^\s*Interpreta[^[\n]*$/gm, '')
      .replace(/^\s*Efecto negativo[^[\n]*$/gm, '')
      .replace(/^\s*Qué mejoraría[^[\n]*$/gm, '')
      // Limpiar líneas vacías múltiples
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * Parsea la respuesta de IA en secciones usando delimitadores ===SECCION:NOMBRE===
 * @param {string} content - Texto completo generado por la IA
 * @returns {Object} Secciones: { introduccion, porcentajes, tipos_respuesta, analisis_heuristico, analisis_heuristico_blocks, comparativa, conclusion }
 */
export function parseAiReportSections(content) {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('[parseAiReportSections] 🔍 INICIO PARSEO')
  console.log('═══════════════════════════════════════════════════════════════')

  // Asegurar que el contenido sea una cadena de texto (previene "object Object" en la UI)
  let textContent = content
  if (typeof content === 'object' && content?.content) {
    textContent = content.content
  }
  // Convertir a string si no lo es
  if (typeof textContent !== 'string') {
    textContent = String(textContent || '').trim()
  }
  // Limpiar residuos de instrucciones de formato del modelo
  textContent = cleanAiOutput(textContent)
  if (!textContent || textContent.length === 0) {
    console.log(
      '[parseAiReportSections] ❌ Contenido inválido:',
      typeof content,
    )
    return {
      introduccion: '',
      porcentajes: '',
      tipos_respuesta: '',
      analisis_heuristico: '',
      analisis_heuristico_blocks: [],
      comparativa: '',
      conclusion: '',
    }
  }

  console.log('[parseAiReportSections] 🧪 Raw content preview:', {
    length: textContent.length,
    approxTokens: Math.ceil(textContent.length / 3.5),
    preview: textContent.slice(0, 400),
    hasSectionMarkers: /===SECCION:/.test(textContent),
    hasMarkdownHeaders: /^##\s+/m.test(textContent),
  })

  const sectionMap = {
    INTRODUCCION: 'introduccion',
    PORCENTAJES: 'porcentajes',
    TIPOS_RESPUESTA: 'tipos_respuesta',
    ANALISIS_HEURISTICO: 'analisis_heuristico',
    COMPARATIVA: 'comparativa',
    CONCLUSION: 'conclusion',
  }

  const regex = /===SECCION:(\w+)===/g
  const parts = textContent.split(regex)
  const sections = {
    introduccion: '',
    porcentajes: '',
    tipos_respuesta: '',
    analisis_heuristico: '',
    comparativa: '',
    conclusion: '',
  }

  for (let i = 1; i < parts.length; i += 2) {
    const tagName = parts[i]
    const key = sectionMap[tagName]
    const text = (parts[i + 1] || '').trim()
    if (key) {
      sections[key] = cleanSectionText(text)
    }
  }

  const hasAnySection = Object.values(sections).some((s) => s.length > 0)
  if (!hasAnySection) {
    console.log(
      '[parseAiReportSections] ⚠️ SIN DELIMITADORES ===SECCION=== - detectando ## headers markdown',
    )
    Object.assign(sections, parseMarkdownHeaders(textContent))
  }

  const hasAnyAfterMarkdown = Object.values(sections).some((s) => s.length > 0)
  if (!hasAnyAfterMarkdown) {
    console.log(
      '[parseAiReportSections] ⚠️ SIN HEADERS MARKDOWN - usando fallback por keywords',
    )
    Object.assign(sections, distributeTextByKeywords(content))
  }

  // Pre-parsear análisis heurístico ANTES de limpiar (para extraer sub-bloques)
  if (sections.analisis_heuristico) {
    sections.analisis_heuristico_blocks = parseHeuristicAnalysis(
      sections.analisis_heuristico,
    )
    console.log(
      '[parseAiReportSections] 🧩 Bloques heurísticos pre-parseados:',
      sections.analisis_heuristico_blocks.length,
    )
  } else {
    sections.analisis_heuristico_blocks = []
  }

  // Ahora limpiar todas las secciones (incluyendo etiquetas [ESTADO_ACTUAL] etc.)
  for (const key of Object.keys(sections)) {
    if (key !== 'analisis_heuristico_blocks') {
      sections[key] = cleanSectionText(sections[key])
    }
  }

  console.log(
    '[parseAiReportSections] 📊 Estado final:',
    Object.fromEntries(
      Object.entries(sections)
        .filter(([k]) => k !== 'analisis_heuristico_blocks')
        .map(([k, v]) => [k, v.length]),
    ),
  )
  console.log('[parseAiReportSections] 🧾 Preview por sección:', {
    introduccion: sections.introduccion.slice(0, 180),
    porcentajes: sections.porcentajes.slice(0, 180),
    tipos_respuesta: sections.tipos_respuesta.slice(0, 180),
    analisis_heuristico: sections.analisis_heuristico.slice(0, 180),
    comparativa: sections.comparativa.slice(0, 180),
    conclusion: sections.conclusion.slice(0, 180),
  })
  console.log('═══════════════════════════════════════════════════════════════')
  return sections
}

/**
 * Parsea secciones por headers markdown (## Nombre) cuando el modelo no usa ===SECCION:===
 */
function parseMarkdownHeaders(textContent) {
  const sections = {
    introduccion: '',
    porcentajes: '',
    tipos_respuesta: '',
    analisis_heuristico: '',
    comparativa: '',
    conclusion: '',
  }
  const headerNameMap = {
    introducción: 'introduccion',
    introduccion: 'introduccion',
    porcentajes: 'porcentajes',
    'porcentajes de usabilidad': 'porcentajes',
    'análisis global': 'porcentajes',
    'tipos de respuesta': 'tipos_respuesta',
    'tipo de respuesta': 'tipos_respuesta',
    'análisis heurístico': 'analisis_heuristico',
    'analisis heuristico': 'analisis_heuristico',
    'análisis detallado': 'analisis_heuristico',
    'heurísticas priorizadas': 'analisis_heuristico',
    comparativa: 'comparativa',
    'comparativa de puntuaciones': 'comparativa',
    conclusión: 'conclusion',
    conclusion: 'conclusion',
    conclusiones: 'conclusion',
    cierre: 'conclusion',
    'investigación web adicional': 'conclusion',
  }
  const headerRegex = /^##\s+(.+)$/gm
  const matches = [...textContent.matchAll(headerRegex)]
  if (matches.length === 0) return sections

  for (let i = 0; i < matches.length; i++) {
    const headerTitle = matches[i][1].trim().toLowerCase()
    const key = headerNameMap[headerTitle]
    if (!key) continue
    const startIdx = matches[i].index + matches[i][0].length
    const endIdx =
      i + 1 < matches.length ? matches[i + 1].index : textContent.length
    const sectionText = textContent.slice(startIdx, endIdx).trim()
    sections[key] = cleanSectionText(sectionText)
  }
  return sections
}

/**
 * Fallback: distribuye texto por keywords cuando no hay delimitadores
 */
function distributeTextByKeywords(content) {
  const sections = {
    introduccion: '',
    porcentajes: '',
    tipos_respuesta: '',
    analisis_heuristico: '',
    comparativa: '',
    conclusion: '',
  }
  const lines = content.split('\n')
  let currentSection = 'introduccion'
  const keywordMap = {
    introduccion: ['introducción', 'sistema evaluado', 'evaluación heurística'],
    porcentajes: [
      'porcentajes',
      'cumplimiento global',
      'evaluador',
      'madurez ux',
    ],
    tipos_respuesta: ['tipos de respuesta', 'no aplica', 'no es posible'],
    analisis_heuristico: [
      'heurística #',
      'h1 —',
      'h2 —',
      'h3 —',
      'estado_actual',
      'impacto_experiencia',
      'plan_accion',
      'prioridad',
      'heurísticas más crític',
      'orden de prior',
    ],
    comparativa: [
      'comparativa',
      'puntuaciones individuales',
      'dispersión',
      'consenso',
    ],
    conclusion: [
      'conclusión',
      'roadmap',
      'valoración final',
      'potencial de mejora',
    ],
  }
  // Mapa de headers markdown a secciones (para fallback)
  const headerFallbackMap = {
    introducción: 'introduccion',
    introduccion: 'introduccion',
    porcentajes: 'porcentajes',
    'tipos de respuesta': 'tipos_respuesta',
    'análisis heurístico': 'analisis_heuristico',
    'analisis heuristico': 'analisis_heuristico',
    comparativa: 'comparativa',
    conclusión: 'conclusion',
    conclusion: 'conclusion',
  }
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (/^={3,}SECCION:\w+={3,}$/i.test(trimmedLine)) continue
    // Detectar ## Headers como marcadores de sección
    const headerMatch = trimmedLine.match(/^##\s+(.+)$/i)
    if (headerMatch) {
      const headerName = headerMatch[1].trim().toLowerCase()
      const mapped = headerFallbackMap[headerName]
      if (mapped) {
        currentSection = mapped
        continue
      }
    }
    const lower = trimmedLine.toLowerCase()
    for (const [section, keywords] of Object.entries(keywordMap)) {
      if (keywords.some((k) => lower.includes(k))) {
        currentSection = section
        break
      }
    }
    sections[currentSection] += trimmedLine + '\n'
  }
  return Object.fromEntries(
    Object.entries(sections).map(([k, v]) => [k, cleanSectionText(v)]),
  )
}

/**
 * Parsea el bloque de análisis heurístico en sub-bloques por heurística
 * @param {string} text - Texto de la sección analisis_heuristico
 * @returns {Array<Object>} Array de objetos { id, index, compliance, estadoActual, impactoExperiencia, planAccion, resumenEjecutivo, lightSummary? }
 */
export function parseHeuristicAnalysis(text) {
  if (!text) return []

  const blocks = []
  // Divide por encabezados de heurística: el prompt (aiReportPrompt.js,
  // sección ANALISIS_HEURISTICO) pide únicamente "H{numero}" en su propia
  // línea — sin porcentaje ni título embebidos — así que el separador debe
  // coincidir exactamente con eso.
  const heuristicHeaderRegex = /^H(\d+)\b/gm

  const headerMatches = [...text.matchAll(heuristicHeaderRegex)]
  const seenIndices = new Set()

  for (let i = 0; i < headerMatches.length; i++) {
    const match = headerMatches[i]
    const index = parseInt(match[1], 10) - 1
    // Descarta repeticiones: el modelo a veces reescribe la misma
    // heurística más adelante en la respuesta.
    if (seenIndices.has(index)) continue
    seenIndices.add(index)

    const nextStart =
      i + 1 < headerMatches.length ? headerMatches[i + 1].index : text.length
    const blockText = text.slice(match.index, nextStart).trim()

    const id = `H${match[1]}`

    // Extraer sub-bloques [ETIQUETA]...[/ETIQUETA]. Las etiquetas deben
    // coincidir EXACTAMENTE con las que pide aiReportPrompt.js:
    // ESTADO_ACTUAL, IMPACTO_NEGATIVO, PROPUESTAS_DE_MEJORA, RESUMEN_EJECUTIVO.
    const extract = (tag) => {
      const regex = new RegExp(
        `\\[${tag}\\]\\s*([\\s\\S]*?)\\[\\/${tag}\\]`,
        'i',
      )
      const m = blockText.match(regex)
      return m ? m[1].trim() : ''
    }

    const estadoActual = extract('ESTADO_ACTUAL')
    const impactoExperiencia = extract('IMPACTO_NEGATIVO')
    const planAccion = extract('PROPUESTAS_DE_MEJORA')
    const resumenEjecutivo = extract('RESUMEN_EJECUTIVO')

    // Heurísticas leves: si no tiene sub-bloques, es una frase resumen
    const isLight =
      !estadoActual && !impactoExperiencia && !planAccion && !resumenEjecutivo
    const lightSummary = isLight
      ? blockText
          .replace(/^H\d+[^\n]*\n?/, '')
          .replace(/\[\/?ESTADO_ACTUAL\]/gi, '')
          .replace(/\[\/?IMPACTO_NEGATIVO\]/gi, '')
          .replace(/\[\/?PROPUESTAS_DE_MEJORA\]/gi, '')
          .replace(/\[\/?RESUMEN_EJECUTIVO\]/gi, '')
          .trim()
      : ''

    blocks.push({
      id,
      index,
      compliance: '',
      title: '',
      estadoActual,
      impactoExperiencia,
      planAccion,
      resumenEjecutivo,
      impactoMejora: '',
      lightSummary,
    })
  }

  return blocks
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
    ollamaUrl = process.env.VUE_APP_OLLAMA_API_URL ||
      'http://localhost:11434/api/chat',
    skipGemini = false,
    skipOllama = false,
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

  // Intenta Gemini primero (a menos que se omita o no tenga cuota)
  if (!skipGemini) {
    if (!hasQuota('gemini')) {
      // Sin cuota, saltar a Ollama
    } else {
      try {
        const result = await generateAiReportWithGemini(finalReportItem)
        const inputTokens = estimateTokens(result.userPrompt || '')
        const outputTokens = estimateTokens(result.content || '')
        trackTokens('gemini', inputTokens + outputTokens)
        if (typeof result === 'string') {
          return {
            content: result,
            webResearch: '',
            source: 'gemini',
            sections: parseAiReportSections(result),
          }
        }
        // generateAiReportWithGemini ya devuelve sections parseadas desde
        // el JSON estructurado (parseGeminiJsonSections) — no hace falta
        // re-parsear el texto libre.
        return {
          ...result,
          sections: result.sections || parseAiReportSections(result.content),
          source: 'gemini',
        }
      } catch (geminiError) {
        if (
          geminiError.message.includes('429') ||
          geminiError.message.includes('quota')
        ) {
          trackTokens('gemini', 250000)
        }

        if (skipOllama) {
          throw geminiError
        }
      }
    }
  }

  // Fallback a Ollama
  if (!skipOllama) {
    try {
      const result = await generateAiReportWithOllama(
        finalReportItem,
        ollamaUrl,
      )
      if (typeof result === 'string') {
        return {
          content: result,
          webResearch: '',
          source: 'ollama',
          sections: parseAiReportSections(result),
        }
      }
      // Ollama ya devuelve sections parseadas por assembleOllamaReport()
      const sections = result.sections || parseAiReportSections(result.content)
      return {
        ...result,
        source: 'ollama',
        sections,
      }
    } catch (ollamaError) {
      console.error('[AI] ❌ Ollama falló:', ollamaError.message)
    }
  }

  // Fallback final: devolver resultado vacío en vez de lanzar error
  // para que el PDF use sus propios textos de respaldo
  console.log(
    '[AI] ⚠️ AMBAS IAs fallaron. El PDF usará sus textos de respaldo.',
  )
  console.log('[AI] ===== FIN GENERACIÓN (Sin IA) =====')
  return {
    content: '',
    webResearch: '',
    source: 'fallback',
    sections: {
      introduccion: '',
      porcentajes: '',
      tipos_respuesta: '',
      analisis_heuristico: '',
      analisis_heuristico_blocks: [],
      comparativa: '',
      conclusion: '',
    },
  }
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

export default {
  generateAiReportWithGemini,
  generateAiReportWithOllama,
  generateAiReportWithFallback,
  useAiReport,
  testGeminiConnection,
  validateApiKey,
  correctCommentsWithAI,
}
