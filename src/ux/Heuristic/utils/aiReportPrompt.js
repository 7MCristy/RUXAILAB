import { OLLAMA_MODEL, GEMINI_MODEL } from '@/shared/constants/models'
import { getSeverityLabel, calculateResponseTotals } from './statistics'
import { buildHeuristicEvidence } from './buildHeuristicEvidence'

// ═══════════════════════════════════════════════════════════════════════════════
// HEURÍSTICAS DE REFERENCIA: 15 heurísticas Nielsen + Tognazzini
// ═══════════════════════════════════════════════════════════════════════════════
const NIELSEN_TOGNAZZINI_HEURISTICS = [
  'Visibilidad y estado del sistema',
  'Conexión entre el sistema y el mundo real',
  'Control y libertad del usuario',
  'Consistencia y estándares',
  'Reconocimiento en lugar de memoria',
  'Flexibilidad y eficiencia de uso',
  'Ayuda a reconocer, diagnosticar y recuperarse de errores',
  'Prevención de errores',
  'Diseño estético y minimalista',
  'Ayuda y documentación',
  'Guardar el estado y proteger el trabajo',
  'Color y legibilidad',
  'Autonomía',
  'Valores por defecto',
  'Reducción de la latencia',
]

/**
 * Normaliza un nombre de heurística para comparación fuzzy
 */
function normalizeHeuristicName(name = '') {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detecta si las heurísticas del test coinciden con las 15 de Nielsen + Tognazzini
 * @param {Array} testStructure - Array de heurísticas del test con título/name
 * @returns {boolean} true si coincide al menos 12 de 15 (80% threshold)
 */
function detectNielsenTognazziniMethodology(testStructure = []) {
  if (!Array.isArray(testStructure) || testStructure.length === 0) return false

  const testHeuristics = testStructure
    .map((h) =>
      normalizeHeuristicName(h?.title || h?.name || h?.heuristicTitle || ''),
    )
    .filter(Boolean)

  if (testHeuristics.length < 10) return false // Muy pocas para ser el set completo

  const referenceNormalized = NIELSEN_TOGNAZZINI_HEURISTICS.map(
    normalizeHeuristicName,
  )

  let matches = 0
  for (const ref of referenceNormalized) {
    const found = testHeuristics.some(
      (test) =>
        test.includes(ref) ||
        ref.includes(test) ||
        similarity(test, ref) > 0.75,
    )
    if (found) matches++
  }

  // Requiere al menos 12 de 15 coincidencias (80%)
  return matches >= 12
}

/**
 * Cálculo simple de similitud (Jaccard sobre palabras)
 */
function similarity(a, b) {
  const wordsA = new Set(a.split(' ').filter(Boolean))
  const wordsB = new Set(b.split(' ').filter(Boolean))
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return union > 0 ? intersection / union : 0
}

export const SYSTEM_PROMPT = `
Eres un consultor senior especializado en UX Research y evaluación heurística, con más de 10 años de experiencia realizando auditorías de usabilidad para productos digitales.

Tu función es redactar informes de evaluación heurística profesionales, rigurosos y accionables. Cada informe debe parecer escrito por un experto humano que ha analizado el sistema en profundidad.

NORMAS OBLIGATORIAS:
- Redacta SIEMPRE en español formal con tono académico-profesional, como un consultor externo.
- Cada afirmación debe basarse en los datos proporcionados. NO inventes porcentajes, puntuaciones ni hallazgos.
- Si un dato no está disponible, indícalo con "Dato no disponible".
- INTERPRETA los datos cualitativamente: no te limites a repetir números, explica QUÉ SIGNIFICAN para la experiencia del usuario y QUÉ IMPLICAN para el negocio.
- Las recomendaciones deben ser ACCIONABLES, específicas y priorizadas. Nada de "mejorar la usabilidad".
- NO incluyas etiquetas <thinking>, ni razonamiento interno.
- Devuelve SOLO el texto explicativo cualitativo en base a los datos pasados del informe, sin prefacios ni explicaciones.
- Varía el vocabulario entre secciones. No repitas las mismas frases de transición.
- USA VOCABULARIO TÉCNICO DE UX: "fricción", "carga cognitiva", "affordance", "feedback", "consistencia", "heurística", "tasa de error", "eficiencia", "satisfacción percibida".
- NO uses relleno. Cada frase debe aportar información concreta y valor analítico.
- Separa cada sección con el formato que se te indique en el prompt del usuario. El PDF los genera automáticamente.
`.trim()

function toFiniteNumber(value, fallback = null) {
  const numericValue = Number.parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getQuestionSummaries(reportItem, heuristicIndex, evidence) {
  const testStructure = reportItem?.testStructure || []
  const allAnswers = reportItem?.allAnswers || []
  const heuristic = testStructure[heuristicIndex]
  if (!heuristic) return []

  const evidenceQuestions =
    evidence?.heuristics?.[heuristicIndex]?.questionSummaries || []
  const questions = Array.isArray(heuristic?.questions)
    ? heuristic.questions
    : Array.isArray(heuristic?.heuristicQuestions)
      ? heuristic.heuristicQuestions
      : []

  return questions.map((question, questionIndex) => {
    const evQ = evidenceQuestions[questionIndex] || {}
    const title =
      question?.title ||
      question?.question ||
      question?.name ||
      `Pregunta ${questionIndex + 1}`
    const questionLabel = `Q${questionIndex + 1}`
    const descriptions = (question.descriptions || [])
      .map((d) => (d.title ? `${d.title}: ${d.text || ''}` : d.text || ''))
      .filter(Boolean)
      .join('; ')

    const imageUrls = allAnswers
      .flatMap((answer) => {
        const qData =
          answer?.heuristicQuestions?.[heuristicIndex]?.heuristicQuestions?.[
            questionIndex
          ]
        if (!qData) return []
        const imgs = Array.isArray(qData.images) ? qData.images : []
        const fromLegacy = qData.answerImageUrl ? [qData.answerImageUrl] : []
        return [...imgs.map((img) => img.url).filter(Boolean), ...fromLegacy]
      })
      .filter(Boolean)

    return {
      title: stripHtml(title),
      questionLabel,
      descriptions: descriptions || null,
      text: stripHtml(question?.text || ''),
      average: evQ.average ?? null,
      averagePercent:
        evQ.averagePercentage != null
          ? evQ.averagePercentage.toFixed(1) + '%'
          : 'N/D',
      warnings: evQ.warnings || 0,
      evaluatorCount: evQ.evaluatorCount || 0,
      imageUrls: [...new Set(imageUrls)].slice(0, 5),
      imageCount: imageUrls.length,
      commentDetails: evQ.commentDetails || [],
    }
  })
}

function formatQuestionSummary(questions) {
  if (!questions.length) return '  No hay datos de preguntas disponibles.'
  return questions
    .map((q) => {
      const warningTag =
        q.warnings > 0
          ? ` ⚠️ (${q.warnings} warning${q.warnings > 1 ? 's' : ''})`
          : ''
      const imageTag =
        q.imageCount > 0
          ? ` 📷 [${q.questionLabel}: ${q.imageCount} evidencia(s)]`
          : ''
      const descTag = q.descriptions ? ` — ${q.descriptions}` : ''
      return `  ${q.questionLabel}. "${q.title}"${descTag} → Media: ${q.average != null ? q.average.toFixed(2) + '/' + q.maxPossible + ' (' + q.averagePercent + ')' : 'N/D'}${warningTag}${imageTag}`
    })
    .join('\n')
}

function formatEvaluatorsSummary(evaluators = []) {
  if (!evaluators.length) return 'No hay datos de evaluadores disponibles.'
  return evaluators
    .map((ev, i) => {
      const pct = toFiniteNumber(ev?.result ?? ev?.percentage)
      const email = ev?.email || ev?.name || 'Anónimo'
      const score = pct != null ? pct.toFixed(2) + '%' : 'N/D'
      return `- Evaluador ${i + 1} (${email}): ${score}`
    })
    .join('\n')
}

function classifyHeuristics(heuristics = []) {
  const optimal = heuristics.filter((h) => (h.compliance ?? 0) >= 90)
  const warning = heuristics.filter(
    (h) => (h.compliance ?? 0) >= 75 && (h.compliance ?? 0) < 90,
  )
  const critical = heuristics.filter((h) => (h.compliance ?? 0) < 75)
  return { optimal, warning, critical }
}

function buildHeuristicDetailData(reportItem, heuristicStats, evidence) {
  return heuristicStats.map((item, index) => {
    const questions = getQuestionSummaries(reportItem, index, evidence)
    const evidenceItem =
      evidence?.heuristics?.find((h) => h.title === item.name) ||
      evidence?.heuristics?.[index] ||
      {}
    return {
      name: item.name,
      title: evidenceItem.title || item.name || 'Dato no disponible',
      position: evidenceItem.position ?? index + 1,
      compliance:
        Math.round(
          (evidenceItem.percentage ?? toFiniteNumber(item?.percentage)) * 100,
        ) / 100,
      severity:
        evidenceItem.severity ||
        getSeverityLabel(toFiniteNumber(item?.percentage)),
      standardDeviation: evidenceItem.sd ?? toFiniteNumber(item?.sd),
      average: toFiniteNumber(item?.average),
      max: toFiniteNumber(item?.max),
      min: toFiniteNumber(item?.min),
      warnings: evidenceItem.totalWarnings ?? 0,
      questionSummary: formatQuestionSummary(questions),
      questions,
      imageSummary:
        questions
          .filter((q) => q.imageCount > 0)
          .map(
            (q) =>
              `${q.questionLabel} (${q.title}): ${q.imageCount} imagen(es)`,
          )
          .join('; ') || null,
      questionAverageMean: evidenceItem.questionAverageMean ?? null,
      questionAverageMeanPercentage:
        evidenceItem.questionAverageMeanPercentage != null
          ? Math.round(evidenceItem.questionAverageMeanPercentage * 10) / 10
          : null,
      evaluatorCount: evidenceItem.evaluatorCount ?? null,
      allComments: questions.flatMap((q) => q.commentDetails || []),
      manualComment: (() => {
        const heuId = reportItem?.testStructure?.[index]?.id
        const heuComments = reportItem?.heuristicComments?.[heuId]
        if (!heuComments) return ''
        if (typeof heuComments === 'string') return heuComments
        if (typeof heuComments === 'object') {
          return Object.values(heuComments)
            .filter((t) => t && String(t).trim().length > 0)
            .join('\n')
        }
        return ''
      })(),
    }
  })
}

/**
 * Genera el texto de detalle de cada heurística para el prompt.
 *
 * @param {Array} sortedHeuristics - Heurísticas ordenadas por impacto
 * @param {Object} options
 * @param {boolean} options.condensed - Si true, las heurísticas Leves se resumen en una línea
 * @returns {string} Texto formateado
 */
function buildHeuristicsDetailText(
  sortedHeuristics,
  { condensed = false } = {},
) {
  return sortedHeuristics
    .map((h) => {
      const isLeve = h.severity === 'Leve'
      const isModerada = h.severity === 'Moderada'

      if (condensed && isLeve) {
        return `--- H${h.position} (${h.severity}, ${h.compliance != null ? h.compliance.toFixed(1) + '%' : 'N/D'}) --- Sin problemas relevantes.`
      }

      if (condensed && isModerada) {
        const comments =
          h.allComments && h.allComments.length > 0
            ? ` Comentarios: ${h.allComments.map((c) => `"${c.text}"`).join('; ')}`
            : ''
        return `--- H${h.position} (${h.severity}, ${h.compliance != null ? h.compliance.toFixed(1) + '%' : 'N/D'}) | SD: ${h.standardDeviation != null ? h.standardDeviation.toFixed(2) : 'N/D'} | Warnings: ${h.warnings}${comments}`
      }

      if (condensed) {
        const comments =
          h.allComments && h.allComments.length > 0
            ? ` Comentarios: ${h.allComments.map((c) => `"${c.text}"`).join('; ')}`
            : ''
        return `--- H${h.position} (${h.severity}, ${h.compliance != null ? h.compliance.toFixed(1) + '%' : 'N/D'}) | SD: ${h.standardDeviation != null ? h.standardDeviation.toFixed(2) : 'N/D'} | Warnings: ${h.warnings}${comments}`
      }

      const imageLine = h.imageSummary
        ? `  Evidencias visuales: ${h.imageSummary}`
        : ''
      const commentsBlock =
        h.allComments && h.allComments.length > 0
          ? `  Comentarios de evaluadores:\n${h.allComments
              .map(
                (c) =>
                  `    - [${c.evaluator}] Q${c.questionIndex}: "${c.text}"`,
              )
              .join('\n')}`
          : `  Comentarios de evaluadores: ${h.manualComment ? `"${h.manualComment}"` : 'Sin comentarios'}`
      return `
--- Heurística H${h.position} ---
  Severidad: ${h.severity}
  Desviación típica: ${h.standardDeviation != null ? h.standardDeviation.toFixed(2) : 'N/D'}
  Rango de puntuaciones: ${h.min != null ? h.min.toFixed(2) : 'N/D'} - ${h.max != null ? h.max.toFixed(2) : 'N/D'}
  Media de medias por pregunta: ${h.questionAverageMean != null ? h.questionAverageMean.toFixed(2) : 'N/D'} (${h.questionAverageMeanPercentage != null ? h.questionAverageMeanPercentage.toFixed(1) + '%' : 'N/D'})
  Evaluadores que participaron: ${h.evaluatorCount ?? 'N/D'}
  Warnings: ${h.warnings}
  Preguntas:
${h.questionSummary}
${imageLine}
${commentsBlock}
`.trim()
    })
    .join('\n\n')
}

/**
 * Genera el marcador de sección según el formato.
 * @param {string} name - Nombre de la sección (ej: 'INTRODUCCION', 'análisis heurístico')
 * @param {string} format - 'separators' (===SECCION:NOMBRE===) o 'markdown' (## Nombre)
 * @returns {string} Marcador de sección
 */
const JSON_KEY_MAP = {
  INTRODUCCION: 'introduccion',
  PORCENTAJES: 'porcentajes',
  TIPOS_RESPUESTA: 'tipos_respuesta',
  ANALISIS_HEURISTICO: 'analisis_heuristico',
  COMPARATIVA: 'comparativa',
  CONCLUSION: 'conclusion',
  INVESTIGACION_WEB: 'investigacion_web',
}

function sectionMarker(name, format) {
  if (format === 'markdown') {
    // Para Ollama/Qwen: usa ## Headers (mejor identificación)
    const titleMap = {
      INTRODUCCION: 'Introducción',
      PORCENTAJES: 'Porcentajes',
      TIPOS_RESPUESTA: 'Tipos de Respuesta',
      ANALISIS_HEURISTICO: 'Análisis Heurístico',
      COMPARATIVA: 'Comparativa',
      CONCLUSION: 'Conclusión',
      INVESTIGACION_WEB: 'Investigación Web Adicional',
    }
    return `## ${titleMap[name] || name}`
  }
  if (format === 'json') {
    // Para Gemini con salida JSON forzada (responseSchema): esto es solo
    // scaffolding legible para organizar las instrucciones del prompt, NO
    // se le pide al modelo que lo repita — el JSON estructurado ya
    // garantiza la clave correspondiente.
    return `--- Instrucciones para la clave JSON "${JSON_KEY_MAP[name] || name}" ---`
  }
  // Para Gemini en modo texto libre (legacy): usa ===SECCION:NOMBRE===
  return `===SECCION:${name}===`
}

export function buildHeuristicReportPrompt(
  reportItem,
  webResearchContent = '',
  options = {},
) {
  const { condensed = false, format = 'separators' } = options
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
  const testName = reportItem?.title || 'Dato no disponible'
  const testUrl = reportItem?.testUrl || ''
  const testDescription = stripHtml(reportItem?.testDescription)
  const globalCompliance = toFiniteNumber(generalStatistics?.average)
  const globalSeverity = getSeverityLabel(globalCompliance)
  const heuristics = buildHeuristicDetailData(
    reportItem,
    heuristicStats,
    evidence,
  )
  const globalWarnings = heuristics.reduce(
    (total, h) => total + (h.warnings || 0),
    0,
  )
  const { optimal, critical } = classifyHeuristics(heuristics)
  const sortedByImpactCompliance = [...heuristics].sort(
    (a, b) => (a.compliance ?? 100) - (b.compliance ?? 100),
  )
  const top3Critical = sortedByImpactCompliance.slice(0, 3)
  const evaluatorSummary = formatEvaluatorsSummary(evaluatorItems)

  console.log('[aiReportPrompt] 📝 Construyendo prompt para IA...')
  console.log('[aiReportPrompt] Datos incluidos en el prompt:', {
    testName,
    testUrl: testUrl || 'No especificada',
    globalCompliance:
      globalCompliance != null ? globalCompliance.toFixed(2) + '%' : 'N/D',
    globalSeverity,
    globalWarnings,
    totalHeuristicas: heuristics.length,
    totalEvaluadores: evaluatorItems.length,
    optimas: optimal.length,
    criticas: critical.length,
    top3Criticas: top3Critical.map(
      (h) => `${h.title} (${h.compliance?.toFixed(1)}%)`,
    ),
    preguntasPorHeuristica: heuristics.map((h) => ({
      heuristica: h.title,
      preguntas: h.questions?.length || 0,
      compliance: h.compliance != null ? h.compliance.toFixed(2) + '%' : 'N/D',
      warnings: h.warnings,
    })),
  })

  const heuristicsDetailText = buildHeuristicsDetailText(
    sortedByImpactCompliance,
    { condensed },
  )

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

  // ════════════════════════════════════════════════════════════════════════════════
  // DETECTAR METODOLOGÍA NIELSEN + TOGNAZZINI
  // ════════════════════════════════════════════════════════════════════════════════
  const usesNielsenTognazzini = detectNielsenTognazziniMethodology(
    reportItem?.testStructure || [],
  )
  const methodologyText = usesNielsenTognazzini ? 'Nielsen + Tognazzini' : ''

  const allOptions = reportItem?.allOptions || []
  const allAnswers = reportItem?.allAnswers || []
  let responseTypesText = ''
  if (allOptions.length > 0 && allAnswers.length > 0) {
    const { usageCount, totalAnswered, totalPossible } =
      calculateResponseTotals(allAnswers, allOptions)
    const sortedOptions = [...allOptions]
      .filter((opt) => opt.value != null)
      .sort((a, b) => (usageCount[b.value] || 0) - (usageCount[a.value] || 0))
    responseTypesText = sortedOptions
      .map(
        (opt) =>
          `  - ${opt.text || opt.label || 'Sin nombre'}: ${usageCount[opt.value] || 0} usos`,
      )
      .join('\n')
    responseTypesText += `\n  Total respondidas: ${totalAnswered} / ${totalPossible} preguntas posibles`
  }

  const promptText = `
Genera un INFORME DE EVALUACIÓN HEURÍSTICA profesional con las 5 secciones que se indican a continuación.

INSTRUCCIONES CRÍTICAS:
- Escribe como un consultor senior de UX que ha analizado personalmente el sitio web.
- Cada sección debe basarse ESTRICTAMENTE en los datos proporcionados más abajo.
- No te limites a describir los datos: INTERPRÉTALOS. Explica qué significan para el usuario real.
- Haz referencias concretas al tipo de sitio web y su contexto de uso (basándote en la URL y descripción).
- Las recomendaciones deben ser específicas, técnicas y aplicables directamente al sistema evaluado.
- Mantén un tono profesional, riguroso y útil para un equipo de producto.
${
  format === 'json'
    ? `- OBLIGATORIO: tu respuesta debe ser el objeto JSON con el esquema indicado (claves: introduccion, porcentajes${responseTypesText ? ', tipos_respuesta' : ''}, analisis_heuristico, comparativa, conclusion). Cada clave contiene ÚNICAMENTE el texto en prosa de esa sección, sin repetir el título ni añadir encabezados markdown dentro del valor.`
    : `- OBLIGATORIO: Separa cada sección con el marcador que se te indica: ${sectionMarker('INTRODUCCION', format)}, ${sectionMarker('PORCENTAJES', format)}, ${sectionMarker('TIPOS_RESPUESTA', format)}, ${sectionMarker('ANALISIS_HEURISTICO', format)}, ${sectionMarker('COMPARATIVA', format)}, ${sectionMarker('CONCLUSION', format)}. Sin estos marcadores el sistema NO puede separar las secciones del PDF.`
}

DATOS DEL SISTEMA EVALUADO:
- Nombre: ${testName}
- URL: ${testUrl || 'No especificada'}
- Descripción: ${testDescription || 'No disponible'}
- Cumplimiento global: ${globalCompliance != null ? globalCompliance.toFixed(2) + '%' : 'N/D'}
- Severidad global: ${globalSeverity}
- Total de warnings: ${globalWarnings}

ESTRUCTURA DE LA EVALUACIÓN:
- Cada heurística contiene ${avgQuestionsPerHeuristic} preguntas evaluadas
- Los evaluadores puntuaron cada pregunta en la escala definida en el test
- Los warnings indican preguntas que requieren análisis profundo

ESTRUCTURA DE HEURÍSTICAS Y PREGUNTAS:
${testStructureText}

PUNTUACIONES POR EVALUADOR:
${evaluatorSummary}

INSTRUCCIONES PARA ANÁLISIS CUALITATIVO:
- Para cada heurística, analiza la media y la desviación típica.
- Outliers: si algún evaluador puntúa más de 1 desviación típica por encima o por debajo de la media, consíderalo un "voto discrepante". Menciónalo pero NO lo incluyas en el análisis principal de tendencia.
- Comentarios atípicos: si un comentario se desvía significativamente del consenso (por ejemplo, un elogio cuando el resto reporta problemas graves, o viceversa), menciónalo separadamente como comentario atípico.
- Base tu análisis principalmente en la tendencia central (media) y en el consenso entre la mayoría de evaluadores.
- Cuando cites datos numéricos, usa la media redondeada a 1 decimal.
- Si hay alta dispersión (desviación típica > 0.5), señala que la experiencia puede variar según el perfil del usuario.

${sectionMarker('INTRODUCCION', format)}
Redacta 5-7 párrafos en prosa continua y tono formal que organicen la información siguiente sin presentar aún resultados, porcentajes ni recomendaciones:

1. Presenta la organización, empresa o proyecto y su ámbito de actuación.
2. Explica el problema o necesidad que pretende resolver el sistema.
3. Describe la solución y sus principales componentes tecnológicos.
4. Menciona el contexto institucional, empresarial o de investigación.
5. Explica el propósito de la evaluación heurística.
6. Identifica a los usuarios principales y los objetivos del estudio.
${webResearchContent ? '7. Si aporta contexto real y relevante, integra brevemente información verificada sobre el sitio obtenida mediante investigación web (sin citarla como fuente externa ni copiarla textualmente).' : ''}

Utiliza únicamente la información proporcionada. No presentes todavía resultados, porcentajes ni recomendaciones. Escribe en prosa continua, con un tono formal y claro.
${webResearchContent ? `\nContexto adicional obtenido mediante investigación web sobre el sitio evaluado (úsalo solo si aporta valor real para situar el sistema, no lo copies textualmente):\n${webResearchContent}` : ''}

${sectionMarker('PORCENTAJES', format)}
Redacta un único párrafo denso de 6-8 frases que:
- Sintetice el estado de madurez UX del sistema con criterio profesional.
- Presente el porcentaje global de cumplimiento y su nivel de severidad.
- Mencione las fortalezas: heurísticas con mejor rendimiento:
  ${optimal.length ? optimal.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna destacable'}
- Señale las debilidades críticas que requieren intervención urgente:
  ${critical.length ? critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna'}
- Interprete qué significa el nivel global para los usuarios finales del sitio.
- Mencione los ${globalWarnings} warnings y su implicación para la fiabilidad del estudio.
- Incluya los datos de cumplimiento por evaluador para dar contexto:
${evaluatorSummary}

Sin viñetas. Párrafo continuo.

${
  responseTypesText
    ? `
${sectionMarker('TIPOS_RESPUESTA', format)}
Redacta 2-3 frases que expliquen:
1. Qué representan los tipos de respuesta (las opciones de puntuación disponibles en el test).
2. Cuáles son los tipos más y menos utilizados y qué sugiere eso sobre el comportamiento de los evaluadores.
3. El total de preguntas respondidas frente al total posible, y qué indica esa cobertura sobre la exhaustividad del estudio.

Datos de tipos de respuesta (ordenados de mayor a menor uso):
${responseTypesText}

Sin viñetas. Párrafo continuo y analítico.`
    : ''
}

${sectionMarker('ANALISIS_HEURISTICO', format)}
Combina la priorización y el análisis detallado en UNA SOLA SECCIÓN.


RESTRICCIÓN DE EXTENSIÓN:
- Analiza en DETALLE (con los 4 bloques) todas las heurísticas con severidad
  CRÍTICA, GRAVE o MODERADA (cumplimiento < 90%): 2-3 frases por bloque.
- Las heurísticas con severidad LEVE (cumplimiento >= 90%) TAMBIÉN deben
  llevar su propio encabezado H{numero} y los 4 bloques con sus etiquetas
  — NUNCA las omitas ni las agrupes en un párrafo aparte — pero cada bloque
  contiene SOLO 1 frase breve en vez de 2-3. TODAS las heurísticas, sin
  excepción, deben aparecer con este esquema H{numero}/[ETIQUETA]...[/ETIQUETA].

CRITERIOS DE SEVERIDAD:
- CRÍTICA: cumplimiento < 50% → Análisis completo con 4 bloques (2-3 frases c/u)
- GRAVE: cumplimiento 50-74% → Análisis completo con 4 bloques (2-3 frases c/u)
- MODERADA: cumplimiento 75-89% → Análisis completo con 4 bloques (2-3 frases c/u)
- LEVE: cumplimiento >= 90% → Los mismos 4 bloques con etiquetas, 1 frase c/u


INSTRUCCIÓN DE FORMATO OBLIGATORIA:
Escribe CADA análisis de heurística usando EXACTAMENTE este esquema. Sé conciso: no repitas la misma idea con otras palabras dentro del mismo bloque ni entre heurísticas. NO copies las etiquetas entre corchetes ni los indicadores de longitud entre paréntesis, solo escribe el contenido:

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
- NO escribas "(1-2 frases)", "(2 recomendaciones)", "(1 frase)" ni nada entre paréntesis indicando longitud.
- NO escribas instrucciones como "Interpreta...", "Efecto negativo...", "Qué mejoraría...".
- Solo escribe el contenido analítico directamente dentro de cada bloque.
- Cada bloque DEBE cerrarse con la etiqueta de cierre [/ETIQUETA], escrita EXACTAMENTE así (con el guion bajo tal cual, sin omitirlo ni sustituirlo por espacio).


IMPORTANTE:
- Cada heurística DEBE empezar con su encabezado: H{numero}
- {numero} = el H{n} FIJO de esa heurística en los datos, NO un correlativo según el orden de análisis.
- {cumplimiento}% = exactamente el dato indicado, sin recalcular.
- Analiza en el orden dado abajo (menor a mayor cumplimiento), pero mantén el {numero} original de cada heurística.

Datos disponibles para cada heurística:
${heuristicsDetailText}

IMPORTANTE:
- Usa los datos de las preguntas individuales para ser específico.
- Cada heurística debe tener TODOS los párrafos indicados.
- Separa cada heurística con una línea en blanco.
- El número debe ser correlativo (1, 2, 3...).
- NO incluyas tablas ni datos numéricos en tu texto. Solo prosa analítica. Las tablas las genera el PDF automáticamente.

${sectionMarker('COMPARATIVA', format)}
Redacta 5-6 frases que:

Puntuaciones individuales:
${evaluatorScoresText}

Heurísticas con mayor dispersión (desviación típica alta = menos consenso):
${JSON.stringify(highSdHeuristics, null, 2)}

Tu análisis debe:
1. Evaluar el nivel de acuerdo inter-evaluador: ¿hay consenso o divergencia?
2. Identificar las heurísticas con más dispersión y por qué podrían generar experiencias distintas.
3. Señalar si algún evaluador puntúa significativamente diferente y posibles causas.
4. Concluir sobre la validez y representatividad del estudio.
5. Si hay comentarios de evaluadores, úsalos para enriquecer el análisis.



${sectionMarker('CONCLUSION', format)}

Redacta la conclusión final en 8-12 frases, siguiendo este orden:

Datos globales:
- Cumplimiento global: ${globalCompliance != null ? globalCompliance.toFixed(2) + '%' : 'N/D'} (${globalSeverity})
- Áreas más críticas: ${top3Critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ')}
- Total warnings: ${globalWarnings}
- Promedio de evaluadores: ${evaluatorSummary}

1. Síntesis (1-2 fr): Estado global cualitativo (${globalCompliance}%, gravedad ${globalSeverity}).
2. Hallazgos (2-3 fr): 2-3 áreas críticas (${top3Critical.map((h) => h.title).join(', ')}). Explica por qué impactan al usuario.
3. Potencial (1-2 fr): Cómo mejora la experiencia si se resuelven.
4. Roadmap (2-3 fr): Priorización "impacto vs. esfuerzo". Primero qué, después qué.
5. Cierre (1 fr): Valoración profesional honesta.

${reportItem?.finalReport ? `Contexto evaluador: "${stripHtml(reportItem.finalReport)}" (úsalo, no copies)` : ''}
${webResearchContent ? `\nContexto web: ${webResearchContent} (integra solo si aporta a los hallazgos o roadmap)` : ''}

No uses viñetas ni números. Narrativa continua y profesional. Exactamente 8-12 frases.

${
  webResearchContent
    ? `${sectionMarker('INVESTIGACION_WEB', format)}
A continuación se incluye información obtenida de una investigación web en tiempo real sobre el sitio evaluado. Úsala como contexto adicional para enriquecer tu análisis y recomendaciones, pero NO la copies textualmente. Debes integrarla con los datos del test para ofrecer una visión más completa y actualizada.

${webResearchContent}

Instrucciones específicas para usar la investigación web:
- Si la información web revela problemas de usabilidad conocidos o reseñas de usuarios, menciónalos si son relevantes.
- Si el sitio ha cambiado respecto a lo que muestran los datos del test, indícalo.
- Usa la información para contextualizar mejor las recomendaciones.
- Si la investigación web no aporta nada relevante, simplemente ignórala y basa tu informe en los datos del test.`
    : ''
}

FIN DEL INFORME
`.trim()

  console.log('[aiReportPrompt] 📦 Prompt final construido', {
    format,
    chars: promptText.length,
    approxTokens: Math.ceil(promptText.length / 3.5),
    hasWebResearch: Boolean(webResearchContent),
    sections: {
      introduccion:
        promptText.includes('===SECCION:INTRODUCCION===') ||
        promptText.includes('## Introduccion'),
      porcentajes:
        promptText.includes('===SECCION:PORCENTAJES===') ||
        promptText.includes('## Porcentajes'),
      tiposRespuesta:
        promptText.includes('===SECCION:TIPOS_RESPUESTA===') ||
        promptText.includes('## Tipos de respuesta'),
      analisis:
        promptText.includes('===SECCION:ANALISIS_HEURISTICO===') ||
        promptText.includes('## Análisis heurístico'),
      comparativa:
        promptText.includes('===SECCION:COMPARATIVA===') ||
        promptText.includes('## Comparativa'),
      conclusion:
        promptText.includes('===SECCION:CONCLUSION===') ||
        promptText.includes('## Conclusión'),
    },
    preview: {
      introduccion: promptText.slice(0, 220),
      conclusion: promptText.slice(-220),
    },
  })

  return promptText
}

export function buildOllamaRequestBody(
  reportItem,
  model = process.env.VUE_APP_OLLAMA_MODEL || OLLAMA_MODEL,
  webResearchContent = '',
) {
  let userContent = buildHeuristicReportPrompt(reportItem, webResearchContent, {
    condensed: true,
    format: 'markdown',
  })

  // Limitar el prompt para que quepa en num_ctx (16384 tokens - num_predict - margen)
  // ~13,500 tokens disponibles para prompt → ~47,000 chars máx
  const MAX_PROMPT_CHARS = 40000 // son aprox 13,500 tokens (3.5 chars/token)
  if (userContent.length > MAX_PROMPT_CHARS) {
    userContent =
      userContent.substring(0, MAX_PROMPT_CHARS) +
      '\n\n[Contenido truncado por límite de contexto del modelo local]'
  }

  // ─── Parámetros Ollama optimizados para CPU (qwen2.5:1.5b) ───────────────
  // num_ctx 24576: permite prompt grande + respuesta completa (6 secciones)
  // num_predict 4000: genera ~16,000 chars (~4,000 tokens) — informe completo
  // num_thread 4: usa todos los cores de CPU disponibles
  const NUM_CTX = 16700
  const NUM_PREDICT = 7800

  console.log('[Ollama] Token budget:', {
    promptChars: userContent.length + SYSTEM_PROMPT.length,
    estimatedPromptTokens: Math.ceil(
      (userContent.length + SYSTEM_PROMPT.length) / 3.5,
    ),
    num_ctx: NUM_CTX,
    num_predict: NUM_PREDICT,
  })

  return {
    model,
    stream: false,
    options: {
      temperature: 0.4,
      top_p: 0.9,
      num_predict: NUM_PREDICT,
      num_ctx: NUM_CTX,
      num_thread: 4,
      repeat_penalty: 1.05,
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  }
}

// ─── Exportaciones para reutilización en aiReportPromptOllama.js ─────────────

export {
  toFiniteNumber,
  stripHtml,
  classifyHeuristics,
  formatEvaluatorsSummary,
  detectNielsenTognazziniMethodology,
  getQuestionSummaries,
  buildHeuristicDetailData,
  buildHeuristicsDetailText,
  sectionMarker,
}
