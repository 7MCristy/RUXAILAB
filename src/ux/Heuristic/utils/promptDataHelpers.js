/**
 * Preparación de datos para los prompts de IA (Gemini y Ollama): da forma
 * a las estadísticas, la evidencia y los textos auxiliares que después
 * consume cada constructor de prompt. No contiene nada de la REDACCIÓN del
 * prompt en sí — eso vive en aiReportPrompt.js / aiReportPromptOllama.js,
 * cada uno con su propia redacción afinada por modelo.
 */

import { getSeverityLabel, calculateResponseTotals } from './statistics'
import { buildHeuristicEvidence } from './buildHeuristicEvidence'
import { stripHtml } from './reportHelpers'
import { detectNielsenTognazziniMethodology } from './nielsenTognazziniDetector'

function toFiniteNumber(value, fallback = null) {
  const numericValue = Number.parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(numericValue) ? numericValue : fallback
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

/**
 * Prepara TODOS los datos derivados que necesita cualquier prompt de
 * informe (Gemini o Ollama): estadísticas, evidencia, clasificación por
 * severidad, textos auxiliares... Es el único lugar donde se calculan
 * estos valores — antes existían dos copias casi idénticas de esta misma
 * lógica, una en aiReportPrompt.js y otra en aiReportPromptOllama.js.
 *
 * Lo que varía entre proveedores (Gemini vs Ollama/Qwen) es la REDACCIÓN
 * de las instrucciones de cada sección del prompt, no estos datos — por
 * eso esa parte sigue viviendo en cada fichero por separado: está afinada
 * empíricamente por modelo y forzarla a ser idéntica degradaría la calidad
 * de alguno de los dos informes.
 *
 * @param {Object} reportItem
 * @param {string} webResearchContent
 * @param {Object} options
 * @param {boolean} options.condensed - Si true, las heurísticas Leves se resumen en una línea dentro de heuristicsDetailText
 */
function prepareReportData(
  reportItem,
  webResearchContent = '',
  { condensed = false } = {},
) {
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
  const { optimal, warning, critical } = classifyHeuristics(heuristics)
  const sortedByImpact = [...heuristics].sort(
    (a, b) => (a.compliance ?? 100) - (b.compliance ?? 100),
  )
  const top3Critical = sortedByImpact.slice(0, 3)
  const evaluatorSummary = formatEvaluatorsSummary(evaluatorItems)
  const heuristicsDetailText = buildHeuristicsDetailText(sortedByImpact, {
    condensed,
  })
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

  return {
    testName,
    testUrl,
    testDescription,
    globalCompliance,
    globalSeverity,
    globalWarnings,
    heuristics,
    optimal,
    warning,
    critical,
    sortedByImpact,
    top3Critical,
    evaluatorItems,
    evaluatorSummary,
    heuristicsDetailText,
    highSdHeuristics,
    evaluatorScoresText,
    testStructureText,
    avgQuestionsPerHeuristic,
    methodologyText,
    responseTypesText,
    webResearchContent,
  }
}

export {
  toFiniteNumber,
  getQuestionSummaries,
  formatQuestionSummary,
  formatEvaluatorsSummary,
  classifyHeuristics,
  buildHeuristicDetailData,
  buildHeuristicsDetailText,
  sectionMarker,
  prepareReportData,
}
