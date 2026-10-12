/**
 * Parseo y ensamblaje de la respuesta que devuelve Ollama/Qwen. No
 * construye nada de prompt — eso vive en aiReportPromptOllama.js. Esta
 * mitad del fichero original era, de hecho, el doble de grande que la
 * mitad que realmente construye el prompt, pese a llevar "Prompt" en el
 * nombre del fichero del que salió.
 */

import { normalizeForFuzzyMatch as normalizeForMatch } from './reportHelpers'

/**
 * Empareja un título libre (tal como lo escribe Qwen) con la heurística más
 * parecida de la lista de datos reales, por solapamiento de palabras.
 * Se usa solo como fallback cuando el modelo no respeta el formato con
 * etiquetas [ESTADO_ACTUAL]... y en su lugar devuelve una lista numerada.
 */
function findHeuristicByTitle(rawTitle, sortedByImpact) {
  const norm = normalizeForMatch(rawTitle)
  if (!norm) return null
  let best = null
  let bestScore = 0
  for (const h of sortedByImpact) {
    const hNorm = normalizeForMatch(h.title)
    if (!hNorm) continue
    if (hNorm === norm) return h
    const wordsA = new Set(norm.split(' ').filter(Boolean))
    const wordsB = new Set(hNorm.split(' ').filter(Boolean))
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
    const union = new Set([...wordsA, ...wordsB]).size
    const score = union ? intersection / union : 0
    if (score > bestScore) {
      bestScore = score
      best = h
    }
  }
  return bestScore >= 0.4 ? best : null
}

/**
 * Fallback cuando no hay NINGÚN encabezado H{numero} reconocible y en su
 * lugar Qwen devuelve una lista numerada tipo "1. **Título**: contenido".
 * Empareja cada ítem con su heurística real por similitud de título y
 * descarta duplicados (Qwen a veces repite la misma lista dos veces).
 */
function parseFallbackHeuristicList(textString, sortedByImpact = []) {
  const itemStartRegex = /^[ \t]*\d+\.\s+/gm
  const starts = [...textString.matchAll(itemStartRegex)]
  if (starts.length === 0) return []

  const seenPositions = new Set()
  const blocks = []
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index + starts[i][0].length
    const end = i + 1 < starts.length ? starts[i + 1].index : textString.length
    const chunk = textString.slice(start, end).trim()
    const labelMatch = chunk.match(
      /^\*{0,2}([^*:\n]{3,120}?)\*{0,2}\s*:\s*([\s\S]*)$/,
    )
    if (!labelMatch) continue
    const rawTitle = labelMatch[1].trim()
    const content = labelMatch[2].trim()
    if (!content) continue

    const matched = findHeuristicByTitle(rawTitle, sortedByImpact)
    if (!matched || seenPositions.has(matched.position)) continue
    seenPositions.add(matched.position)

    blocks.push({
      id: `H${matched.position}`,
      index: matched.position - 1,
      compliance:
        matched.compliance != null ? `${matched.compliance.toFixed(1)}%` : '',
      title: matched.title || rawTitle,
      estadoActual: '',
      impactoExperiencia: '',
      planAccion: content,
      resumenEjecutivo: '',
      impactoMejora: '',
      lightSummary: content,
    })
  }
  return blocks
}

// Reconoce la etiqueta de cada subapartado sea cual sea el formato exacto
// que use el modelo. Se probó a sustituir los corchetes por un título suelto
// en mayúscula anclado a línea completa (sin contenido detrás), pero eso
// dejaba el apartado vacío en cuanto el modelo escribía el contenido a
// continuación del título en la MISMA línea (algo muy habitual pese a
// pedir lo contrario) — de ahí que el bloque completo desapareciera. Los
// corchetes SÍ funcionan de forma fiable con Gemini porque no dependen de
// que no haya nada más en la línea: basta con detectar el token "[ETIQUETA]"
// en cualquier posición. Se combinan tres formas tolerantes:
//   1) Con corchetes "[ESTADO_ACTUAL]"/"[/ESTADO_ACTUAL]": NO se ancla a
//      inicio de línea (el corchete ya es señal suficiente de que es una
//      etiqueta) y el contenido puede continuar en la misma línea.
//      slash1 indica si es la etiqueta de CIERRE.
//   2) Sin corchetes, con dos puntos "Estado Actual: ...": SÍ se ancla a
//      inicio de línea (^, con [ \t]* — no \s*, que se comería la línea
//      en blanco anterior) para no confundirla con la frase "estado
//      actual" dentro de una oración normal. El contenido puede continuar
//      en la misma línea, justo después de los dos puntos. Tolera además
//      viñeta "- " y negrita markdown alrededor de la etiqueta y/o de los
//      dos puntos (p.ej. "- **Impacto Negativo:**", "**Estado actual:**"),
//      que en la práctica es el formato MÁS habitual que produce Qwen —
//      sin esto, el bloque entero quedaba vacío pese a tener contenido.
//   3) Sin corchetes ni dos puntos, título suelto en su propia línea
//      ("ESTADO ACTUAL" y ya en la línea siguiente el contenido): fallback
//      final para cuando el modelo omite tanto los corchetes como los dos
//      puntos.
// Guion bajo, espacio o sin separador entre palabras, y singular/plural en
// "propuesta(s)", se toleran en los tres casos.
const LABEL_TOKEN_REGEX =
  /\[(?<slash1>\/)?\s*(?<label1>ESTADO[ _]?ACTUAL|IMPACTO[ _]?NEGATIVO|PROPUESTAS?[ _]?DE[ _]?MEJORA|RESUMEN[ _]?EJECUTIVO)\s*\]|^[ \t]*(?:[-*]\s*)?\*{0,2}(?<label2>ESTADO[ _]?ACTUAL|IMPACTO[ _]?NEGATIVO|PROPUESTAS?[ _]?DE[ _]?MEJORA|RESUMEN[ _]?EJECUTIVO)\*{0,2}\s*:\*{0,2}|^[ \t]*(?<label3>ESTADO[ _]?ACTUAL|IMPACTO[ _]?NEGATIVO|PROPUESTAS?[ _]?DE[ _]?MEJORA|RESUMEN[ _]?EJECUTIVO)[ \t]*$/gim

const LABEL_KEY_MAP = {
  ESTADOACTUAL: 'estadoActual',
  IMPACTONEGATIVO: 'impactoExperiencia',
  PROPUESTADEMEJORA: 'planAccion',
  PROPUESTASDEMEJORA: 'planAccion',
  RESUMENEJECUTIVO: 'resumenEjecutivo',
}

// El modelo a veces copia literalmente la frase-instrucción del prompt en
// vez de sustituirla por contenido real (se observa sobre todo cuando
// además se salta la etiqueta del apartado, ver logs de analisis_lote_3/4)
// — se retiran tal cual si aparecen, para no colarlas en el PDF.
const INSTRUCTION_LEAK_REGEX =
  /Máximo 2 frases interpretando el estado cualitativo\.|Máximo 2 frases con el efecto negativo concreto en el usuario, considerando el porcentaje de cumplimiento y la media de respuestas\. Si hay información web, integra cómo afecta a usuarios reales\.|Máximo 2 recomendaciones específicas y técnicas en infinitivo, en frases cortas\. Basándote en comentarios de evaluadores y, si está disponible, en la investigación web\.|Exactamente 1 frase resumen para el equipo de desarrollo\./g

/**
 * Limpia el contenido de un subapartado: quita cualquier etiqueta residual
 * (p.ej. la de cierre "[/ESTADO_ACTUAL]"), líneas placeholder sueltas tipo
 * "[Título]", frases de instrucción copiadas literalmente, viñetas "- ", y
 * convierte los saltos de línea en prosa.
 */
function cleanBlockContent(text) {
  if (!text) return ''
  return String(text)
    .replace(LABEL_TOKEN_REGEX, ' ')
    .replace(/^[ \t]*\[[^\]\n]{1,40}\][ \t]*$/gm, '')
    .replace(INSTRUCTION_LEAK_REGEX, '')
    .replace(/^[ \t]*[-*]\s+/gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Extrae, dentro del texto de UNA heurística, el contenido de cada
 * subapartado reconocido, tolerando variaciones de formato (con o sin
 * corchetes, con o sin guion bajo). Devuelve cadenas vacías para los
 * subapartados que no aparezcan.
 */
function extractLabeledBlocks(blockText) {
  const result = {
    estadoActual: '',
    impactoExperiencia: '',
    planAccion: '',
    resumenEjecutivo: '',
  }
  const allMatches = [...blockText.matchAll(LABEL_TOKEN_REGEX)]
  // slash1 solo existe en la forma con corchetes y solo se rellena cuando
  // es la etiqueta de CIERRE "[/...]" — esos matches no abren un apartado.
  const openMatches = allMatches.filter((m) => !m.groups.slash1)
  if (openMatches.length === 0) return result

  // Contenido ANTES de la primera etiqueta reconocida: a veces el modelo
  // empieza a analizar directamente (o etiqueta el primer apartado de una
  // forma irreconocible) y solo acierta el formato en los apartados
  // siguientes — sin este rescate ese texto se perdía sin más. Se
  // descarta la línea de encabezado "H{numero} / Título" y se asigna
  // como estadoActual (el primer apartado esperado) si no queda vacío.
  const leadingRaw = blockText
    .slice(0, openMatches[0].index)
    .replace(/^H\d+[^\n]*\n?/, '')
  const leading = cleanBlockContent(leadingRaw)
  if (leading) {
    result.estadoActual = leading
  }

  for (let i = 0; i < openMatches.length; i++) {
    const label =
      openMatches[i].groups.label1 ||
      openMatches[i].groups.label2 ||
      openMatches[i].groups.label3
    const key = LABEL_KEY_MAP[label.toUpperCase().replace(/[ _]/g, '')]
    if (!key) continue
    const start = openMatches[i].index + openMatches[i][0].length
    const end =
      i + 1 < openMatches.length ? openMatches[i + 1].index : blockText.length
    const content = cleanBlockContent(blockText.slice(start, end))
    if (content) {
      result[key] = result[key] ? `${result[key]} ${content}` : content
    }
  }
  return result
}

/**
 * Parser genérico y SIN dependencia de datos externos: localiza cada
 * heurística por su encabezado real "H{numero}" (el único elemento que
 * tanto Qwen como Gemini suelen respetar de forma fiable, porque se les
 * pide explícitamente que usen el H{n} FIJO de los datos) y, dentro de
 * cada bloque, extrae los subapartados con extractLabeledBlocks. Si un
 * bloque no tiene ninguna etiqueta reconocible, usa el contenido completo
 * del bloque como análisis general en lugar de perder el dato. Se
 * reutiliza tanto desde el flujo de Ollama (parseHeuristicBlocksByHeader,
 * que además valida contra los datos reales del lote) como desde
 * geminiReportService.js (parseHeuristicAnalysis), que recibe todas las
 * heurísticas en una sola llamada y no necesita esa validación.
 */
export function parseHeuristicBlocksGeneric(textString) {
  const blockStartRegex = /^H(\d+)\b/gm
  const starts = [...textString.matchAll(blockStartRegex)]
  if (starts.length === 0) return []

  const seenPositions = new Set()
  const blocks = []
  for (let i = 0; i < starts.length; i++) {
    const position = parseInt(starts[i][1], 10)
    // Descarta repeticiones: el modelo a veces reescribe la misma
    // heurística más adelante en la respuesta.
    if (seenPositions.has(position)) continue
    seenPositions.add(position)

    const blockStart = starts[i].index
    const blockEnd =
      i + 1 < starts.length ? starts[i + 1].index : textString.length
    const blockText = textString.slice(blockStart, blockEnd)

    const labeled = extractLabeledBlocks(blockText)
    const hasAnyLabel = Object.values(labeled).some(Boolean)

    if (hasAnyLabel) {
      blocks.push({
        id: `H${position}`,
        index: position - 1,
        compliance: '',
        title: '',
        estadoActual: labeled.estadoActual,
        impactoExperiencia: labeled.impactoExperiencia,
        planAccion: labeled.planAccion,
        resumenEjecutivo: labeled.resumenEjecutivo,
        impactoMejora: '',
        lightSummary: '',
      })
    } else {
      // Ninguna etiqueta reconocida: se usa el bloque completo (tras el
      // encabezado H{n}) como análisis general, para no perder el dato.
      const rawContent = blockText.replace(/^H\d+[^\n]*\n?/, '')
      const content = cleanBlockContent(rawContent)
      blocks.push({
        id: `H${position}`,
        index: position - 1,
        compliance: '',
        title: '',
        estadoActual: '',
        impactoExperiencia: '',
        planAccion: content,
        resumenEjecutivo: '',
        impactoMejora: '',
        lightSummary: content,
      })
    }
  }
  return blocks
}

/**
 * Variante para Ollama: además de parseHeuristicBlocksGeneric, valida cada
 * H{n} contra los datos reales del lote (descarta alucinaciones que no
 * correspondan a ninguna heurística de ESTE lote) y rellena compliance/title.
 */
function parseHeuristicBlocksByHeader(textString, sortedByImpact = []) {
  const dataByPosition = new Map()
  for (const h of sortedByImpact) {
    if (h?.position != null) dataByPosition.set(h.position, h)
  }

  return parseHeuristicBlocksGeneric(textString)
    .filter((block) => dataByPosition.has(block.index + 1))
    .map((block) => {
      const hData = dataByPosition.get(block.index + 1)
      return {
        ...block,
        compliance:
          hData.compliance != null ? `${hData.compliance.toFixed(1)}%` : '',
        title: hData.title || '',
      }
    })
}

export function parseOllamaHeuristicBatch(textString, sortedByImpact = []) {
  try {
    console.log('[Ollama:Parse] 📥 Input:', textString.length, 'chars')
    console.log(
      '[Ollama:Parse] 📥 Primeros 200 chars:',
      textString.substring(0, 200),
    )

    const blocks = parseHeuristicBlocksByHeader(textString, sortedByImpact)
    console.log(
      '[Ollama:Parse] 📊 Heurísticas parseadas (por encabezado H{n}):',
      blocks.length,
    )
    if (blocks.length > 0) {
      for (const h of blocks) {
        console.log(
          `[Ollama:Parse]   ${h.id}: titulo="${h.title.substring(0, 30)}...", estado_actual=${h.estadoActual.length} chars, plan=${h.planAccion.length} chars`,
        )
      }
      return blocks
    }

    console.warn(
      '[Ollama:Parse] ⚠️ Sin encabezados H{n} reconocibles, probando lista numerada de fallback',
    )
    const fallback = parseFallbackHeuristicList(textString, sortedByImpact)
    console.log(
      '[Ollama:Parse] 📊 Heurísticas parseadas (fallback numerado):',
      fallback.length,
    )
    return fallback
  } catch (e) {
    console.error('[Ollama:Parse] ❌ Error parseando texto:', e.message)
    console.error(
      '[Ollama:Parse] ❌ Texto recibido (primeros 500 chars):',
      textString.substring(0, 500),
    )
    return []
  }
}

/**
 * Separa la respuesta combinada de intro_porcentajes en sus dos secciones.
 * Busca los encabezados markdown "## ..." que Qwen debe repetir tal cual se
 * le pidió (vía sectionMarker), clasifica cada uno por palabra clave
 * (introdu.../porcent...) y descarta el propio encabezado, dejando solo el
 * contenido estructurado debajo de él. Si Qwen no respeta los encabezados,
 * recurre a dividir por párrafos: a Porcentajes se le pide EXPLÍCITAMENTE un
 * único párrafo de síntesis (ver promptIntroPorcentajes), así que ese rol lo
 * cumple el ÚLTIMO párrafo de la respuesta; todo lo anterior es Introducción.
 */
export function parseIntroPorcentajes(text) {
  console.log(
    '[Ollama:parseIntro] 📥 Input:',
    text ? text.length + ' chars' : 'NULL',
  )
  if (!text) return { introduccion: '', porcentajes: '' }

  const headerRegex = /^##\s*([^\n]+)$/gm
  const matches = [...text.matchAll(headerRegex)]
  const known = matches.filter((m) => {
    const label = m[1].trim().toLowerCase()
    return label.startsWith('introdu') || label.startsWith('porcent')
  })

  let result
  if (known.length > 0) {
    result = { introduccion: '', porcentajes: '' }
    for (let i = 0; i < known.length; i++) {
      const label = known[i][1].trim().toLowerCase()
      const key = label.startsWith('introdu') ? 'introduccion' : 'porcentajes'
      const start = known[i].index + known[i][0].length
      const end = i + 1 < known.length ? known[i + 1].index : text.length
      result[key] = cleanSingleSection(text.slice(start, end))
    }
    console.log('[Ollama:parseIntro] ✅ Dividido por encabezados markdown:', {
      introduccion: result.introduccion.length,
      porcentajes: result.porcentajes.length,
    })
  } else {
    console.warn(
      '[Ollama:parseIntro] ⚠️ Sin encabezados ## reconocibles, usando fallback por párrafos',
    )
    const cleaned = cleanSingleSection(text)
    const parts = cleaned.split(/\n\s*\n/).filter((p) => p.trim())
    if (parts.length >= 2) {
      const porcentaje = parts[parts.length - 1].trim()
      const intro = parts.slice(0, -1).join('\n\n').trim()
      result = {
        introduccion: cleanSingleSection(intro),
        porcentajes: cleanSingleSection(porcentaje),
      }
    } else {
      result = { introduccion: cleanSingleSection(cleaned), porcentajes: '' }
    }
  }

  console.log('[Ollama:parseIntro] 📊 Resultado final:', {
    introduccion: result.introduccion.length,
    porcentajes: result.porcentajes.length,
  })
  return result
}

// Etiquetas de apartado que Qwen tiende a repetir literalmente aunque se le
// pida prosa continua sin encabezados (p.ej. "1. Síntesis: ..." en la
// conclusión, o "**Título**: ..." en cualquier párrafo).
// OJO: usar [ \t]* (no \s*) delante de estos patrones — \s también matchea
// \n, así que un \s* inicial se "comería" la línea en blanco anterior y
// fusionaría dos párrafos en uno al eliminar la etiqueta.
const KNOWN_SECTION_LABELS =
  /^[ \t]*(S[ií]ntesis|Hallazgos|Potencial|Roadmap|Cierre)\s*:\s*/gim

function cleanSingleSection(text) {
  if (!text) return ''
  return (
    String(text)
      .replace(/^##\s+.+$/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[ \t]*PÁRRAFO\s*\d+.*$/gim, '')
      .replace(
        /^(?:Introducción|Introduccion|Resumen|Conclusión|Conclusion|Porcentajes|Porcentajes de usabilidad)\s*:?\s*$/gim,
        '',
      )
      .replace(/^[ \t]*PARRAFO\s*\d+.*$/gim, '')
      .replace(
        /^(?:Área crítica|Area crítica|ÁREA CRÍTICA|AREA CRITICA)\s*#?\d+\s*(?:\([^)]*\))?\s*[:\-]?\s*/gim,
        '',
      )
      .replace(
        /^(?:Heurística|Heuristica|Heuristic)\s*H?\d+\s*[:\-]?\s*/gim,
        '',
      )
      // Negrita/cursiva markdown (Qwen las usa a veces como pseudo-títulos)
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      // Numeración de lista ("1. ", "2. ") que se cuela pese a pedir prosa continua
      .replace(/^[ \t]*\d+\.\s+/gm, '')
      .replace(KNOWN_SECTION_LABELS, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

export function assembleOllamaReport(results, sortedByImpact = []) {
  console.log('[Ollama:Assemble] 📥 Results recibidos:', Object.keys(results))
  const sections = {
    introduccion: '',
    porcentajes: '',
    tipos_respuesta: '',
    analisis_heuristico: '',
    analisis_heuristico_blocks: [],
    comparativa: '',
    conclusion: '',
  }
  if (results.intro_porcentajes) {
    console.log(
      '[Ollama:Assemble] 📝 Parseando intro_porcentajes:',
      results.intro_porcentajes.length,
      'chars',
    )
    const p = parseIntroPorcentajes(results.intro_porcentajes)
    sections.introduccion = p.introduccion
    sections.porcentajes = p.porcentajes
    console.log(
      '[Ollama:Assemble] ✅ Introducción:',
      p.introduccion.length,
      'chars, Porcentajes:',
      p.porcentajes.length,
      'chars',
    )
  } else {
    console.warn('[Ollama:Assemble] ⚠️ intro_porcentajes es NULL')
  }
  // tipos_respuesta y comparativa no se generan en el plan de Ollama (quedan
  // reservados a aiReportPrompt.js / Gemini); se mantienen vacíos aquí.
  const allBlocks = []
  const batchEntries = Object.entries(results).filter(([k]) =>
    k.startsWith('analisis_lote_'),
  )
  console.log('[Ollama:Assemble] 📦 Lotes encontrados:', batchEntries.length)
  for (const [k, v] of batchEntries) {
    if (v) {
      console.log(`[Ollama:Assemble] 📦 Parseando ${k}:`, v.length, 'chars')
      const blocks = parseOllamaHeuristicBatch(v, sortedByImpact)
      console.log(
        `[Ollama:Assemble] ✅ ${k}: ${blocks.length} heurísticas extraídas`,
      )
      allBlocks.push(...blocks)
    } else {
      console.warn(`[Ollama:Assemble] ⚠️ ${k} es NULL, saltando`)
    }
  }
  allBlocks.sort(
    (a, b) =>
      parseInt(a.id.replace(/\D/g, '')) - parseInt(b.id.replace(/\D/g, '')),
  )
  sections.analisis_heuristico_blocks = allBlocks
  console.log(
    '[Ollama:Assemble] 📊 Total bloques de análisis:',
    allBlocks.length,
  )
  sections.analisis_heuristico = allBlocks
    .map((b) => {
      const hdr = b.compliance
        ? `### ${b.id} — ${b.compliance} — ${b.title}`
        : `### ${b.id} — ${b.title}`
      return `${hdr}\n[ESTADO_ACTUAL]${b.estadoActual}[/ESTADO_ACTUAL]\n[IMPACTO_NEGATIVO]${b.impactoExperiencia}[/IMPACTO_NEGATIVO]\n[PROPUESTAS_DE_MEJORA]${b.planAccion}[/PROPUESTAS_DE_MEJORA]\n[RESUMEN_EJECUTIVO]${b.resumenEjecutivo}[/RESUMEN_EJECUTIVO]`
    })
    .join('\n\n')
  sections.conclusion = cleanSingleSection(results.conclusion || '')
  console.log(
    '[Ollama:Assemble] ✅ Conclusión:',
    sections.conclusion.length,
    'chars',
  )
  console.log('[Ollama:Assemble] 📊 Secciones finales:', {
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
