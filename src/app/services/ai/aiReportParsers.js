/**
 * Parseo de la respuesta de texto libre de un LLM en las secciones del
 * informe. Se usa como fallback cuando el proveedor no devuelve ya
 * secciones estructuradas (Gemini en modo JSON y Ollama vía
 * assembleOllamaReport() ya las traen hechas; esto cubre el resto de
 * casos: texto plano con delimitadores, con headers markdown, o sin
 * ningún marcador reconocible).
 */

import { stripMarkdown } from '@/ux/Heuristic/utils/reportHelpers'
import { parseHeuristicBlocksGeneric } from '@/ux/Heuristic/utils/ollamaResponseParser'

function emptySections() {
  return {
    introduccion: '',
    porcentajes: '',
    tipos_respuesta: '',
    analisis_heuristico: '',
    comparativa: '',
    conclusion: '',
  }
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
 * Parsea secciones por headers markdown (## Nombre) cuando el modelo no usa ===SECCION:===
 */
function parseMarkdownHeaders(textContent) {
  const sections = emptySections()
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
  const sections = emptySections()
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
  // Reutiliza el mismo parser tolerante que usa Ollama (aiReportPromptOllama.js):
  // localiza cada heurística por su encabezado real "H{numero}" y extrae los
  // subapartados [ESTADO_ACTUAL]/[IMPACTO_NEGATIVO]/[PROPUESTAS_DE_MEJORA]/
  // [RESUMEN_EJECUTIVO] tolerando variaciones de formato (con o sin
  // corchetes, con o sin guion bajo, o sin separador alguno entre palabras
  // — se ha observado que los LLM a veces "comen" el guion bajo de las
  // etiquetas).
  return parseHeuristicBlocksGeneric(text)
}

/**
 * Parsea la respuesta de IA en secciones usando delimitadores ===SECCION:NOMBRE===
 * Cascada de 3 estrategias, de más a menos fiable: delimitadores explícitos
 * → headers markdown (## Nombre) → distribución heurística por keywords.
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
    return { ...emptySections(), analisis_heuristico_blocks: [] }
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
  const sections = emptySections()

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

export { cleanSectionText, cleanAiOutput }
