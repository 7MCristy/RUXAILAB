import { OLLAMA_MODEL } from '@/shared/constants/models'
import {
  SYSTEM_PROMPT,
  buildHeuristicDetailData,
  buildHeuristicsDetailText,
  toFiniteNumber,
  stripHtml,
  classifyHeuristics,
  formatEvaluatorsSummary,
  detectNielsenTognazziniMethodology,
  sectionMarker,
} from './aiReportPrompt'
import { buildHeuristicEvidence } from './buildHeuristicEvidence'
import { getSeverityLabel } from './statistics'

const HEURISTICS_PER_BATCH = 4

const OLLAMA_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

NORMAS ADICIONALES PARA ANÁLISIS CUANTITATIVO:
- Basa el análisis en la media del grupo de evaluadores (tendencia central), no en un único evaluador.
- Si el máximo o el mínimo de una heurística se aleja de la media más de una desviación típica (SD), trátalo como "voto discrepante": menciónalo como aparte, no lo uses para caracterizar la heurística en general.
- Si un comentario contradice claramente el consenso (elogio cuando el resto reporta problemas graves, o al revés), trátalo como comentario atípico, no como opinión mayoritaria.
- Si la SD de una heurística es mayor a 0.5, indica que la experiencia puede variar según el perfil o contexto del usuario.
- Redondea las cifras que menciones a 1 decimal.
- NO uses relleno. Cada frase debe aportar información concreta y valor analítico.
- NO repitas la misma frase, idea o lista dos veces dentro de una misma respuesta. Escribe cada idea una única vez y avanza.
- NO generes contenido genérico basado en tu conocimiento previo de las heurísticas de usabilidad: usa EXCLUSIVAMENTE los datos numéricos y cualitativos concretos que se te proporcionan en el prompt.`.trim()

function prepareData(reportItem, webResearchContent = '') {
  const heuristicStats = reportItem?.statisticsByHeuristics?.items || []
  const evidence = buildHeuristicEvidence({
    allAnswers: reportItem?.allAnswers || [],
    testStructure: reportItem?.testStructure || [],
    heuristicsStatistics: heuristicStats,
    heuristicComments: reportItem?.heuristicComments || {},
    testOptions: reportItem?.allOptions || [],
  })
  const generalStatistics = reportItem?.generalStatistics || {}
  const evaluatorItems = reportItem?.statisticsTable?.items || []
  const heuristics = buildHeuristicDetailData(
    reportItem,
    heuristicStats,
    evidence,
  )
  const globalCompliance = toFiniteNumber(generalStatistics?.average)
  const globalSeverity = getSeverityLabel(globalCompliance)
  const globalWarnings = heuristics.reduce((t, h) => t + (h.warnings || 0), 0)
  const { optimal, warning, critical } = classifyHeuristics(heuristics)
  const sortedByImpact = [...heuristics].sort(
    (a, b) => (a.compliance ?? 100) - (b.compliance ?? 100),
  )
  const top3Critical = sortedByImpact.slice(0, 3)
  const evaluatorSummary = formatEvaluatorsSummary(evaluatorItems)
  const methodologyText = detectNielsenTognazziniMethodology(
    reportItem?.testStructure || [],
  )
    ? 'Nielsen + Tognazzini'
    : ''
  const testName = reportItem?.title || 'Dato no disponible'
  const testUrl = reportItem?.testUrl || ''
  const testDescription = stripHtml(reportItem?.testDescription)
  const highSdHeuristics = [...heuristics]
    .filter((h) => h.standardDeviation != null)
    .sort((a, b) => (b.standardDeviation ?? 0) - (a.standardDeviation ?? 0))
    .slice(0, 5)
    .map((h) => ({
      name: h.title,
      sd: h.standardDeviation,
      compliance: h.compliance,
    }))
  const evaluatorScoresText = evaluatorItems.length
    ? evaluatorItems
        .map((ev, i) => {
          const pct = toFiniteNumber(ev?.result ?? ev?.percentage)
          return `  Evaluador ${i + 1}: ${pct != null ? pct.toFixed(2) + '%' : 'N/D'}`
        })
        .join('\n')
    : '  No disponibles'
  const testStructureText =
    (reportItem?.testStructure || [])
      .map((h, i) => {
        const questions = h.questions || h.heuristicQuestions || []
        const qTitles = questions
          .map(
            (q, qi) =>
              `    Q${qi + 1}: ${stripHtml(q.title || q.name || 'Sin título')}`,
          )
          .join('\n')
        return `  H${i + 1}: ${stripHtml(h.title || h.name || 'Sin título')}\n${qTitles}`
      })
      .join('\n') || '  No disponible'
  const avgQuestionsPerHeuristic = Math.round(
    (reportItem?.testStructure || []).reduce(
      (sum, h) =>
        sum + (h.questions?.length || h.heuristicQuestions?.length || 0),
      0,
    ) / Math.max((reportItem?.testStructure || []).length, 1),
  )
  const heuristicsDetailText = buildHeuristicsDetailText(sortedByImpact, {
    condensed: false,
  })
  return {
    testName,
    testUrl,
    testDescription,
    globalCompliance,
    globalSeverity,
    globalWarnings,
    heuristics,
    sortedByImpact,
    top3Critical,
    optimal,
    warning,
    critical,
    evaluatorItems,
    evaluatorSummary,
    methodologyText,
    highSdHeuristics,
    evaluatorScoresText,
    testStructureText,
    avgQuestionsPerHeuristic,
    heuristicsDetailText,
    webResearchContent,
  }
}

export function buildOllamaPlan(
  reportItem,
  model = process.env.VUE_APP_OLLAMA_MODEL || OLLAMA_MODEL,
  webResearchContent = '',
) {
  const d = prepareData(reportItem, webResearchContent)
  const promptText = promptIntroPorcentajes(d)
  const promptTextConclusion = promptConclusion(d)
  console.log('[Ollama] Plan:', {
    testName: d.testName,
    model,
    totalHeuristicas: d.heuristics.length,
    optimas: d.optimal.length,
    criticas: d.critical.length,
    lotes: Math.ceil(d.heuristics.length / HEURISTICS_PER_BATCH),
    tieneWebResearch: Boolean(webResearchContent),
    contextWindow: 14336,
    estimatedPromptChars: {
      intro: promptText.length,
      conclusion: promptTextConclusion.length,
    },
    estimatedPromptTokens: {
      intro: Math.ceil(promptText.length / 3.5),
      conclusion: Math.ceil(promptTextConclusion.length / 3.5),
    },
    preview: {
      intro: promptText.slice(0, 200),
      conclusion: promptTextConclusion.slice(0, 200),
    },
  })
  const calls = []
  // Petición 1: Introducción + Porcentajes combinadas en una sola llamada
  calls.push({
    key: 'intro_porcentajes',
    requestBody: {
      model,
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.9,
        num_ctx: 14336,
        num_predict: 6000,
        num_thread: 4,
        repeat_penalty: 1.2,
        repeat_last_n: 256,
      },
      messages: [
        { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
        { role: 'user', content: promptIntroPorcentajes(d) },
      ],
    },
  })
  // Petición(es): análisis heurístico por lotes (una llamada por lote)
  const batchTexts = batches(d)
  batchTexts.forEach((batch, i) => {
    calls.push({
      key: `analisis_lote_${i + 1}`,
      requestBody: {
        model,
        stream: false,
        options: {
          temperature: 0.25,
          top_p: 0.9,
          num_ctx: 12288,
          num_predict: 8800,
          num_thread: 4,
          repeat_penalty: 1.3,
          repeat_last_n: 256,
        },
        messages: [
          { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
          { role: 'user', content: batch },
        ],
      },
    })
  })
  // Petición final: Conclusión (funde comparativa dentro de la conclusión para
  // Ollama; incluye la investigación web ya obtenida)
  calls.push({
    key: 'conclusion',
    requestBody: {
      model,
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.9,
        num_ctx: 12288,
        num_predict: 4000,
        num_thread: 4,
        repeat_penalty: 1.2,
        repeat_last_n: 256,
      },
      messages: [
        { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
        { role: 'user', content: promptConclusion(d) },
      ],
    },
  })
  return {
    calls,
    meta: {
      testName: d.testName,
      globalCompliance: d.globalCompliance,
      globalSeverity: d.globalSeverity,
      totalHeuristics: d.heuristics.length,
      totalBatches: Math.ceil(d.heuristics.length / HEURISTICS_PER_BATCH),
      hasWebResearch: Boolean(webResearchContent),
      sortedByImpact: d.sortedByImpact,
    },
  }
}

/**
 * Petición combinada: Introducción + Porcentajes en una sola llamada a Qwen.
 * Se le pide a Qwen que marque cada sección con su encabezado markdown
 * (## Introducción / ## Porcentajes, vía sectionMarker reutilizado de
 * aiReportPrompt.js) para poder separarlas después con assembleOllamaReport().
 */
function promptIntroPorcentajes(d) {
  const webContext = d.webResearchContent
    ? `\nContexto adicional obtenido mediante investigación web sobre el sitio evaluado (intégralo brevemente en la introducción solo si aporta valor real para situar el sistema; no lo copies textualmente ni lo cites como fuente externa):\n${d.webResearchContent}\n`
    : ''
  return `DATOS DEL SISTEMA EVALUADO:
- Nombre: ${d.testName}
- URL: ${d.testUrl || 'No especificada'}
- Descripción: ${d.testDescription || 'No disponible'}
- Cumplimiento global: ${d.globalCompliance != null ? d.globalCompliance.toFixed(2) + '%' : 'N/D'}
- Severidad global: ${d.globalSeverity}
- Total de warnings: ${d.globalWarnings}
- Evaluadores: ${d.evaluatorItems.length}${d.methodologyText ? `\n- Metodología: ${d.methodologyText}` : ''}

ESTRUCTURA DE HEURÍSTICAS Y PREGUNTAS:
${d.testStructureText}

PUNTUACIONES POR EVALUADOR:
${d.evaluatorSummary}

HEURÍSTICAS POR RENDIMIENTO:
- Óptimas (>=90%): ${d.optimal.length ? d.optimal.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna destacable'}
- Críticas (<75%): ${d.critical.length ? d.critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna'}
- Intermedias (75-89%): ${d.warning.length ? d.warning.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna'}
${webContext}
INSTRUCCIONES PARA ANÁLISIS CUALITATIVO:
- Outliers: si algún evaluador puntúa más de 1 desviación típica por encima o por debajo de la media, consíderalo un "voto discrepante". Menciónalo pero NO lo incluyas en el análisis principal de tendencia.
- Comentarios atípicos: si un comentario se desvía significativamente del consenso, menciónalo separadamente como comentario atípico.
- Base tu análisis principalmente en la tendencia central (media) y en el consenso entre la mayoría de evaluadores.
- Si hay alta dispersión (desviación típica > 0.5), señala que la experiencia puede variar según el perfil del usuario.

Vas a redactar DOS secciones dentro de esta misma respuesta. Cada sección debe empezar EXACTAMENTE en su propia línea con el encabezado markdown indicado (dos almohadillas seguidas del título, tal cual), sin numerarlo ni modificarlo, y sin añadir ningún otro encabezado o subtítulo.

OBLIGATORIO: la sección Introducción NUNCA puede quedar vacía ni casi vacía. Escribe sus 5-7 párrafos completos justo debajo de su encabezado, ANTES de escribir el encabezado de Porcentajes. No dejes contenido de la introducción para después del encabezado de Porcentajes.

${sectionMarker('INTRODUCCION', 'markdown')}
Redacta 5-7 párrafos en prosa continua y tono formal que organicen la siguiente información sin presentar aún resultados, porcentajes ni recomendaciones, y de tres a cuatro lineas cada uno:

1. Presenta la organización, empresa o proyecto y su ámbito de actuación.
2. Explica el problema o necesidad que pretende resolver el sistema.
3. Describe la solución y sus principales componentes tecnológicos.
4. Menciona el contexto institucional, empresarial o de investigación.
5. Explica el propósito de la evaluación heurística.
6. Identifica a los usuarios principales y los objetivos del estudio.
${d.webResearchContent ? '7. Si aporta contexto real, integra brevemente la información de investigación web sobre el sitio, sin citarla como fuente externa ni copiarla textualmente.' : ''}

Utiliza únicamente la información proporcionada. No presentes todavía resultados, porcentajes ni recomendaciones. Escribe en prosa continua, con un tono formal y claro. Debajo del encabezado escribe solo el texto de los párrafos, sin repetir el título ni añadir subtítulos.

${sectionMarker('PORCENTAJES', 'markdown')}
Redacta un ÚNICO párrafo denso de 6-8 frases (nunca una lista ni una enumeración) que:
- Sintetice el estado de madurez UX del sistema con criterio profesional.
- Presente el porcentaje global de cumplimiento y su nivel de severidad.
- Mencione, como máximo, 2-3 fortalezas concretas (heurísticas con mejor rendimiento) sin enumerar las 15 heurísticas.
- Señale, como máximo, 2-3 debilidades críticas que requieren intervención urgente, sin enumerar las 15 heurísticas.
- Interprete qué significa el nivel global para los usuarios finales del sitio.
- Mencione los ${d.globalWarnings} warnings y su implicación para la fiabilidad del estudio.
- Incluya los datos de cumplimiento por evaluador para dar contexto.

PROHIBIDO: no listes ni numeres las 15 heurísticas una por una (ese desglose completo ya se hace en otra sección). Sin viñetas, sin numeración, un único párrafo continuo. Debajo del encabezado escribe solo el párrafo, sin repetir el título ni añadir subtítulos, y no lo repitas dos veces.`
}

function batches(d) {
  const result = []
  const sorted = d.sortedByImpact
  for (let i = 0; i < sorted.length; i += HEURISTICS_PER_BATCH) {
    const slice = sorted.slice(i, i + HEURISTICS_PER_BATCH)
    const heuristicsText = slice
      .map((h) => {
        const imageLine = h.imageSummary
          ? `  Evidencias visuales: ${h.imageSummary}`
          : ''
        const commentsBlock =
          h.allComments && h.allComments.length > 0
            ? `  Comentarios de evaluadores:\n${h.allComments.map((c) => `    - [${c.evaluator}] Q${c.questionIndex}: "${c.text}"`).join('\n')}`
            : `  Comentarios de evaluadores: ${h.manualComment ? `"${h.manualComment}"` : 'Sin comentarios'}`
        return `--- Heurística H${h.position} ---
  Título: ${h.title}
  Severidad: ${h.severity}
  Cumplimiento: ${h.compliance != null ? h.compliance.toFixed(1) + '%' : 'N/D'}
  Desviación típica: ${h.standardDeviation != null ? h.standardDeviation.toFixed(2) : 'N/D'}
  Rango de puntuaciones: ${h.min != null ? h.min.toFixed(2) : 'N/D'} - ${h.max != null ? h.max.toFixed(2) : 'N/D'}
  Media: ${h.average != null ? h.average.toFixed(2) : 'N/D'} | Media de medias por pregunta: ${h.questionAverageMean != null ? h.questionAverageMean.toFixed(2) : 'N/D'} (${h.questionAverageMeanPercentage != null ? h.questionAverageMeanPercentage.toFixed(1) + '%' : 'N/D'})
  Evaluadores que participaron: ${h.evaluatorCount ?? 'N/D'}
  Warnings: ${h.warnings}
  Preguntas:
${h.questionSummary}
${imageLine}
${commentsBlock}`
      })
      .join('\n\n')
    const webContext = d.webResearchContent
      ? `\nContexto web (integra solo si aporta a hallazgos o recomendaciones):\n${d.webResearchContent}\n`
      : ''
    result.push(`Eres un consultor senior de UX. Analiza cada heurística aplicando estrictamente las reglas del system prompt.

DATOS A ANALIZAR: exactamente ${slice.length} heurísticas, indicadas más abajo con su código H{numero} real. Analiza SOLO esas ${slice.length}, ni una más ni una menos. No inventes ni añadas heurísticas que no estén en la lista de datos, aunque las reconozcas de las 15 heurísticas estándar de Nielsen + Tognazzini: usa EXCLUSIVAMENTE los porcentajes, comentarios y preguntas concretos que se te dan abajo, no tu conocimiento genérico sobre esas heurísticas.

RESTRICCIÓN DE EXTENSIÓN:
- Analiza en DETALLE (con los 4 bloques) todas las heurísticas con severidad CRÍTICA, GRAVE o MODERADA (cumplimiento < 90%).
- Las heurísticas con severidad LEVE (cumplimiento >= 90%) TAMBIÉN deben llevar su propio encabezado H{numero} y los 4 bloques con sus etiquetas — NUNCA las omitas ni las agrupes en un párrafo aparte — pero cada bloque contiene SOLO 1 frase breve en vez de 2-3. TODAS las heurísticas del lote, sin excepción, deben aparecer con este esquema H{numero}/[ETIQUETA]...[/ETIQUETA].
- Sé breve: cada bloque tiene el límite de frases indicado abajo. No lo superes ni repitas la misma idea con otras palabras dentro del mismo bloque.

CRITERIOS DE SEVERIDAD:
- CRÍTICA: cumplimiento < 50% → Análisis completo con 4 bloques
- GRAVE: cumplimiento 50-74% → Análisis completo con 4 bloques
- MODERADA: cumplimiento 75-89% → Análisis completo con 4 bloques
- LEVE: cumplimiento >= 90% → Los mismos 4 bloques con etiquetas, 1 frase c/u

INSTRUCCIÓN DE FORMATO OBLIGATORIA:
Escribe CADA análisis de heurística usando EXACTAMENTE este esquema. NO copies las etiquetas entre corchetes ni los indicadores de longitud entre paréntesis, solo escribe el contenido:

H{numero}
[ESTADO_ACTUAL]
Máximo 2 frases interpretando el estado cualitativo.
[/ESTADO_ACTUAL]
[IMPACTO_NEGATIVO]
Máximo 2 frases con el efecto negativo concreto en el usuario, considerando el porcentaje de cumplimiento y la media de respuestas. Si hay información web, integra cómo afecta a usuarios reales.
[/IMPACTO_NEGATIVO]
[PROPUESTAS_DE_MEJORA]
Máximo 2 recomendaciones específicas y técnicas en infinitivo, en frases cortas. Basándote en comentarios de evaluadores y, si está disponible, en la investigación web.
[/PROPUESTAS_DE_MEJORA]
[RESUMEN_EJECUTIVO]
Exactamente 1 frase resumen para el equipo de desarrollo.
[/RESUMEN_EJECUTIVO]

REGLAS DE FORMATO:
- Solo escribe el contenido analítico directamente dentro de cada bloque.
- Cada bloque DEBE cerrarse con la etiqueta de cierre [/ETIQUETA].
- Separa cada heurística con una línea en blanco.
- Escribe cada heurística UNA SOLA VEZ. No repitas ninguna heurística ni generes la lista completa dos veces en la misma respuesta.

IMPORTANTE:
- Cada heurística DEBE empezar con su encabezado: H{numero}
- {numero} = el H{n} FIJO de esa heurística en los datos, NO un correlativo según el orden de análisis.
- Analiza en el orden dado abajo (menor a mayor cumplimiento), pero mantén el {numero} original.

Datos disponibles para cada heurística (analiza SOLO estas ${slice.length}):
${heuristicsText}
${webContext}
No incluyas títulos de sección ni numeración de párrafos, solo los bloques por heurística. No repitas contenido ya escrito en esta misma respuesta.`)
  }
  return result
}

function promptConclusion(d) {
  const web = d.webResearchContent
    ? `\nContexto web (integra solo si aporta a hallazgos o roadmap):\n${d.webResearchContent}\n`
    : ''
  return `Datos globales:
- Cumplimiento global: ${d.globalCompliance != null ? d.globalCompliance.toFixed(2) + '%' : 'N/D'} (${d.globalSeverity})
- Áreas más críticas: ${d.top3Critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ')}
- Total warnings: ${d.globalWarnings}
- Promedio de evaluadores: ${d.evaluatorSummary}
${web}
Redacta la conclusión final en 8-12 frases, sin viñetas ni números, narrativa continua y profesional exactamente en este orden:

1. Síntesis: Estado global cualitativo del sistema con el ${d.globalCompliance != null ? d.globalCompliance.toFixed(2) + '%' : 'N/D'} de cumplimiento y gravedad ${d.globalSeverity}.
2. Hallazgos: 2-3 áreas críticas (${d.top3Critical.map((h) => h.title).join(', ')}) y por qué impactan directamente a la experiencia del usuario al completar tareas o comprender la interfaz.
3. Potencial: Cómo mejorarían la experiencia del usuario y la usabilidad general si se resolven estas áreas críticas.
4. Roadmap: Priorización "impacto vs. esfuerzo" - primero qué problema crítico de alta relevancia se abordará y después qué mejoras de mediano esfuerzo complementan la solución.
5. Cierre: Valoración profesional honesta del estado actual y perspectivas a corto plazo.

No uses viñetas ni números. Narrativa continua y profesional. Exactamente 8-12 frases.`
}

/**
 * Recorta un texto a un número máximo de frases, para evitar que un modelo
 * pequeño divague o repita contenido dentro del análisis de una sola
 * heurística (que debe ser breve).
 */
// Marcador temporal (zona de uso privado de Unicode) para proteger puntos
// decimales al dividir en frases -- nunca aparece en texto real, a
// diferencia de un espacio, que si podria confundirse con espacios
// normales al restaurar.
const DECIMAL_DOT_PLACEHOLDER = String.fromCharCode(57344)

function truncateToSentences(text, maxSentences = 3) {
  if (!text) return ''
  const str = String(text).trim()
  // Protege puntos decimales (p.ej. "16.5%", muy frecuentes en este
  // informe) para que NO se cuenten como fin de frase al dividir: si no,
  // "16.5%. Aunque..." se partia en "16." + "5%." y se comia la frase
  // siguiente sin necesidad, dejando el analisis mas corto de lo pedido.
  const protectedStr = str.replace(
    /(\d)\.(\d)/g,
    `$1${DECIMAL_DOT_PLACEHOLDER}$2`,
  )
  const restore = (s) => s.split(DECIMAL_DOT_PLACEHOLDER).join('.')
  const sentences = protectedStr.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g)
  if (!sentences || sentences.length <= maxSentences) return restore(protectedStr)
  return restore(sentences.slice(0, maxSentences).join('')).trim()
}

function normalizeForMatch(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

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
      planAccion: truncateToSentences(content, 3),
      resumenEjecutivo: '',
      impactoMejora: '',
      lightSummary: truncateToSentences(content, 3),
    })
  }
  return blocks
}

// Reconoce la etiqueta de cada subapartado sea cual sea el formato exacto
// que use el modelo: con corchetes "[ESTADO_ACTUAL]"/"[/ESTADO_ACTUAL]",
// sin corchetes "Estado Actual:", con guion bajo, con espacio o sin
// separador alguno ("ESTADOACTUAL" — se ha visto en la práctica que tanto
// Ollama como Gemini a veces "comen" el guion bajo), singular o plural en
// "propuesta(s)".
//
// Dos alternativas con reglas de anclaje DISTINTAS, porque en la práctica
// los modelos meten varias etiquetas en la misma línea (p.ej.
// "[/ESTADO_ACTUAL] [IMPACTO_NEGATIVO]texto..."):
//   1) Forma con corchetes: NO se ancla a inicio de línea (los corchetes ya
//      son una señal suficientemente inequívoca de que es una etiqueta, no
//      prosa normal). slash1 indica si es la etiqueta de CIERRE.
//   2) Forma sin corchetes "Estado Actual: ...": SÍ se ancla a inicio de
//      línea (^, con [ \t]* — no \s*, que se comería la línea anterior),
//      porque sin corchetes es la única forma de no confundirla con la
//      frase "estado actual" apareciendo dentro de una oración normal
//      (p.ej. "la media del estado actual es...").
const LABEL_TOKEN_REGEX =
  /\[(?<slash1>\/)?\s*(?<label1>ESTADO[ _]?ACTUAL|IMPACTO[ _]?NEGATIVO|PROPUESTAS?[ _]?DE[ _]?MEJORA|RESUMEN[ _]?EJECUTIVO)\s*\]|^[ \t]*[-*]?\s*(?<label2>ESTADO[ _]?ACTUAL|IMPACTO[ _]?NEGATIVO|PROPUESTAS?[ _]?DE[ _]?MEJORA|RESUMEN[ _]?EJECUTIVO)\s*:/gim

const LABEL_KEY_MAP = {
  ESTADOACTUAL: 'estadoActual',
  IMPACTONEGATIVO: 'impactoExperiencia',
  PROPUESTADEMEJORA: 'planAccion',
  PROPUESTASDEMEJORA: 'planAccion',
  RESUMENEJECUTIVO: 'resumenEjecutivo',
}

/**
 * Limpia el contenido de un subapartado: quita cualquier etiqueta residual
 * (p.ej. la de cierre "[/ESTADO_ACTUAL]"), líneas placeholder sueltas tipo
 * "[Título]", viñetas "- ", y convierte los saltos de línea en prosa.
 */
function cleanBlockContent(text) {
  if (!text) return ''
  return String(text)
    .replace(LABEL_TOKEN_REGEX, ' ')
    .replace(/^[ \t]*\[[^\]\n]{1,40}\][ \t]*$/gm, '')
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

  for (let i = 0; i < openMatches.length; i++) {
    const label = openMatches[i].groups.label1 || openMatches[i].groups.label2
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
        estadoActual: truncateToSentences(labeled.estadoActual, 2),
        impactoExperiencia: truncateToSentences(labeled.impactoExperiencia, 3),
        planAccion: truncateToSentences(labeled.planAccion, 3),
        resumenEjecutivo: truncateToSentences(labeled.resumenEjecutivo, 1),
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
        planAccion: truncateToSentences(content, 3),
        resumenEjecutivo: '',
        impactoMejora: '',
        lightSummary: truncateToSentences(content, 3),
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
 * recurre a dividir por el primer salto de párrafo como último recurso.
 */
/**
 * A Porcentajes se le pide EXPLÍCITAMENTE un único párrafo (ver
 * promptIntroPorcentajes). Si el resultado trae varios párrafos y la
 * Introducción quedó sospechosamente corta, es casi seguro que Qwen no
 * repartió el contenido entre los dos encabezados y volcó todo bajo
 * "Porcentajes". En ese caso, todos los párrafos salvo el último (que sí
 * cumple el patrón de síntesis pedido) se reasignan a la Introducción.
 */
function rebalanceIntroPorcentajes(result) {
  const INTRO_TOO_SHORT_CHARS = 200
  if (result.introduccion.length >= INTRO_TOO_SHORT_CHARS) return result

  const porcParas = result.porcentajes.split(/\n\n+/).filter((p) => p.trim())
  if (porcParas.length <= 1) return result

  const lastParagraph = porcParas[porcParas.length - 1].trim()
  const leadingParagraphs = porcParas.slice(0, -1).join('\n\n').trim()

  console.warn(
    '[Ollama:parseIntro] ⚠️ Introducción sospechosamente corta y Porcentajes con varios párrafos: reasignando párrafos sobrantes a Introducción',
  )

  return {
    introduccion: [result.introduccion, leadingParagraphs]
      .filter(Boolean)
      .join('\n\n')
      .trim(),
    porcentajes: lastParagraph,
  }
}

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
    const parts = cleaned.split(/\n\s*\n/)
    if (parts.length >= 2) {
      const intro = parts[0].trim()
      const porcentaje = parts.slice(1).join('\n\n').trim()
      result = {
        introduccion: cleanSingleSection(intro),
        porcentajes: cleanSingleSection(porcentaje),
      }
    } else {
      result = { introduccion: cleanSingleSection(cleaned), porcentajes: '' }
    }
  }

  result = rebalanceIntroPorcentajes(result)
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
