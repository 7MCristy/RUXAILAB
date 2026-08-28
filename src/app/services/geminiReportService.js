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

async function checkOllamaAvailable(url = 'http://localhost:11434') {
  const tagsUrl = `${url.replace(/\/$/, '')}/api/tags`
  const startedAt = Date.now()

  try {
    console.log('[Ollama] Comprobando disponibilidad:', tagsUrl)
    const response = await fetch(tagsUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
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
        maxOutputTokens: 9500,
        systemInstruction: SYSTEM_PROMPT,
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

          return { content, webResearch: webResearchContent || '', userPrompt }
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
 * Genera informe con Ollama usando buildOllamaRequestBody
 *
 * @param {Object} finalReportItem - Datos del informe
 * @param {string} ollamaUrl - URL de Ollama (default: localhost:11434)
 * @returns {Promise<string>} Contenido del informe
 */
export async function generateAiReportWithOllama(
  finalReportItem,
  ollamaUrl = process.env.VUE_APP_OLLAMA_API_URL ||
    'http://localhost:11434/api/chat',
) {
  try {
    const baseUrl = ollamaUrl.replace('/api/chat', '')
    const model = process.env.VUE_APP_OLLAMA_MODEL || 'qwen2.5:1.5b'

    console.log('[Ollama] Inicio de generación:', {
      url: ollamaUrl,
      baseUrl,
      model,
    })

    const isAvailable = await checkOllamaAvailable(baseUrl)
    if (!isAvailable) {
      throw new Error('Ollama no está disponible')
    }

    const body = buildOllamaRequestBody(finalReportItem, model)
    const bodyJson = JSON.stringify(body)
    console.log('[Ollama] Petición preparada:', {
      model: body.model,
      stream: body.stream,
      bodySizeKB: (bodyJson.length / 1024).toFixed(1),
      promptChars: body.messages?.reduce(
        (total, message) => total + String(message.content || '').length,
        0,
      ),
      messageCount: body.messages?.length || 0,
    })

    const startedAt = Date.now()
    let response
    try {
      response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyJson,
      })
    } catch (fetchError) {
      console.error('[Ollama] Fetch falló:', {
        name: fetchError?.name,
        message: fetchError?.message,
        durationMs: Date.now() - startedAt,
        url: ollamaUrl,
      })
      throw fetchError
    }

    console.log('[Ollama] Respuesta HTTP:', {
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    })

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 500)
      console.error('[Ollama] Cuerpo de error:', errorBody)
      throw new Error(
        `Ollama HTTP ${response.status}: ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`,
      )
    }

    const data = await response.json()
    const content = String(data?.message?.content || '').trim()

    console.log('[Ollama] JSON recibido:', {
      hasMessage: Boolean(data?.message),
      responseChars: content.length,
      done: data?.done,
    })

    if (!content) {
      throw new Error('Ollama devolvió respuesta vacía')
    }

    return { content, webResearch: '', source: 'ollama' }
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
    .replace(/={3,}SECCION:\w+={3,}/gi, '')
    .replace(/^##\s+.+$/gm, '')
    .replace(/\[PROPOSITO\]/gi, '')
    .replace(/\[\/PROPOSITO\]/gi, '')
    .replace(/\[ESTADO_ACTUAL\]/gi, '')
    .replace(/\[\/ESTADO_ACTUAL\]/gi, '')
    .replace(/\[IMPACTO_EXPERIENCIA\]/gi, '')
    .replace(/\[\/IMPACTO_EXPERIENCIA\]/gi, '')
    .replace(/\[PLAN_ACCION\]/gi, '')
    .replace(/\[\/PLAN_ACCION\]/gi, '')
    .replace(/\[RESUMEN_EJECUTIVO\]/gi, '')
    .replace(/\[\/RESUMEN_EJECUTIVO\]/gi, '')
    .replace(/\[IMPACTO_MEJORA\]/gi, '')
    .replace(/\[\/IMPACTO_MEJORA\]/gi, '')
    .replace(/\[ESTADO_ACTUAL\]/gi, '')
    .replace(/\[\/ESTADO_ACTUAL\]/gi, '')
    .replace(/\[IMPACTO_NEGATIVO\]/gi, '')
    .replace(/\[\/IMPACTO_NEGATIVO\]/gi, '')
    .replace(/\[PROPUESTAS_DE_MEJORA\]/gi, '')
    .replace(/\[\/PROPUESTAS_DE_MEJORA\]/gi, '')
    .replace(/\/PROPOSITO/gi, '')
    .replace(/\/ESTADO_ACTUAL/gi, '')
    .replace(/\/IMPACTO_EXPERIENCIA/gi, '')
    .replace(/\/PLAN_ACCION/gi, '')
    .replace(/\/RESUMEN_EJECUTIVO/gi, '')
    .replace(/\/IMPACTO_MEJORA/gi, '')
    .replace(/\/IMPACTO_NEGATIVO/gi, '')
    .replace(/\/PROPUESTAS_DE_MEJORA/gi, '')
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
 * @returns {Object} Secciones: { introduccion, porcentajes, tipos_respuesta, analisis_heuristico, comparativa, conclusion }
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
      comparativa: '',
      conclusion: '',
    }
  }

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

  console.log(
    '[parseAiReportSections] 📊 Estado final:',
    Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length])),
  )
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
    'introducción': 'introduccion',
    'introduccion': 'introduccion',
    'porcentajes': 'porcentajes',
    'tipos de respuesta': 'tipos_respuesta',
    'análisis heurístico': 'analisis_heuristico',
    'analisis heuristico': 'analisis_heuristico',
    'comparativa': 'comparativa',
    'conclusión': 'conclusion',
    'conclusion': 'conclusion',
  }
  const headerRegex = /^##\s+(.+)$/gm
  const matches = [...textContent.matchAll(headerRegex)]
  if (matches.length === 0) return sections

  for (let i = 0; i < matches.length; i++) {
    const headerTitle = matches[i][1].trim().toLowerCase()
    const key = headerNameMap[headerTitle]
    if (!key) continue
    const startIdx = matches[i].index + matches[i][0].length
    const endIdx = i + 1 < matches.length ? matches[i + 1].index : textContent.length
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
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (/^={3,}SECCION:\w+={3,}$/i.test(trimmedLine)) continue
    if (/^##\s+/.test(trimmedLine)) continue
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
  // Divide por encabezados de heurística: "H1 — 45% — Nombre" o "H1 - 45% - Nombre"
  const heuristicHeaderRegex = /^H(\d+)\s*[—–-]\s*(\d+)%\s*[—–-]\s*(.+)$/gm

  const headerMatches = [...text.matchAll(heuristicHeaderRegex)]

  for (let i = 0; i < headerMatches.length; i++) {
    const match = headerMatches[i]
    const nextStart =
      i + 1 < headerMatches.length ? headerMatches[i + 1].index : text.length
    const blockText = text.slice(match.index, nextStart).trim()

    const id = `H${match[1]}`
    const index = parseInt(match[1]) - 1
    const compliance = `${match[2]}%`
    const title = match[3].trim()

    // Extraer sub-bloques [ETIQUETA]...[/ETIQUETA]
    const extract = (tag) => {
      const regex = new RegExp(
        `\\[${tag}\\]\\s*([\\s\\S]*?)\\[\\/${tag}\\]`,
        'i',
      )
      const m = blockText.match(regex)
      return m ? m[1].trim() : ''
    }

    const proposito = extract('PROPOSITO')
    const estadoActual = extract('ESTADO_ACTUAL')
    const impactoExperiencia = extract('IMPACTO_EXPERIENCIA')
    const planAccion = extract('PLAN_ACCION')
    const resumenEjecutivo = extract('RESUMEN_EJECUTIVO')
    const impactoMejora = extract('IMPACTO_MEJORA')

    // Heurísticas leves: si no tiene sub-bloques, es una frase resumen
    const isLight =
      !estadoActual &&
      !impactoExperiencia &&
      !planAccion &&
      !resumenEjecutivo &&
      !impactoMejora
    const lightSummary = isLight
      ? blockText
          .replace(/^H\d+\s*[—–-].*\n?/, '')
          .replace(/\[\/?PROPOSITO\]/gi, '')
          .replace(/\[\/?ESTADO_ACTUAL\]/gi, '')
          .replace(/\[\/?IMPACTO_EXPERIENCIA\]/gi, '')
          .replace(/\[\/?PLAN_ACCION\]/gi, '')
          .replace(/\[\/?RESUMEN_EJECUTIVO\]/gi, '')
          .replace(/\[\/?IMPACTO_MEJORA\]/gi, '')
          .trim()
      : ''

    blocks.push({
      id,
      index,
      compliance,
      title,
      proposito,
      estadoActual,
      impactoExperiencia,
      planAccion,
      resumenEjecutivo,
      impactoMejora,
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
        return {
          ...result,
          sections: parseAiReportSections(result.content),
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
      return {
        ...result,
        source: 'ollama',
        sections: parseAiReportSections(result.content),
      }
    } catch (ollamaError) {
      // Ollama también falló, usar fallback genérico
      console.error('[AI] ❌ Ollama falló:', ollamaError.message)
    }
  }

  // Fallback final: lanzar error para que pdfGenerator use sus propios textos
  console.log('[AI] ⚠️ AMBAS IAs fallaron. El PDF usará sus textos de respaldo.')
  console.log('[AI] ===== FIN GENERACIÓN (Sin IA) =====')
  throw new Error('No hay IA disponible. El PDF generará su propio contenido.')
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
