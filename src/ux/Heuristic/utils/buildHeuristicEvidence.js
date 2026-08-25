import {
  getMaxQuestionScore,
  getNumber,
  getEvaluatorLabel,
  getQuestionLabel,
  getHeuristicLabel,
  getHeuristicShortTitle,
  calculateHeuristicCompliance,
  calcStandardDeviation,
  getHeuristicDomainWeight,
  getSeverityLabelFromPercentage,
  normalizeText,
  stripHtml,
} from './pdfGenerator'
import {
  getQuestionCommentTexts,
  classifyQuestionResponse,
} from '@/ux/Heuristic/utils/statistics'

/**
 * Looks up researcher comments for a given heuristic across multiple key formats.
 */
function findHeuristicComments(heuristicComments, heuristic, heuristicIndex) {
  if (!heuristicComments || typeof heuristicComments !== 'object') return null
  const keys = [
    `H${heuristicIndex + 1}`,
    String(heuristicIndex),
    String(heuristicIndex + 1),
    heuristic?.id,
    heuristic?.heuristicId,
  ].filter(Boolean)
  for (const key of keys) {
    if (heuristicComments[key]) return heuristicComments[key]
  }
  return null
}

/**
 * Construye la evidencia detallada de cada heurística a partir de
 * las respuestas de evaluadores y la estructura del test.
 *
 * @param {Object} options
 * @param {Array}  options.allAnswers         - Respuestas de todos los evaluadores
 * @param {Array}  options.testStructure      - Estructura del test (heurísticas + preguntas)
 * @param {Array}  options.heuristicsStatistics - Estadísticas precalculadas (opcional)
 * @param {Object} options.heuristicComments   - Comentarios del investigador por heurística
 * @param {Array}  options.testOptions         - Opciones de respuesta del test
 * @returns {{ heuristics: Array, orderedByPercentage: Array, orderedByImpact: Array }}
 */
function buildHeuristicEvidence({
  allAnswers = [],
  testStructure = [],
  heuristicsStatistics = [],
  heuristicComments = {},
  testOptions = [],
}) {
  const maxQuestionScore = getMaxQuestionScore(testOptions)
  const heuristics = testStructure.map((heuristic, heuristicIndex) => {
    const evaluatorHeuristics = allAnswers
      .map((answer) => answer?.heuristicQuestions?.[heuristicIndex])
      .filter(Boolean)
    const questionDefinitions = Array.isArray(heuristic?.questions)
      ? heuristic.questions
      : Array.isArray(heuristic?.heuristicQuestions)
        ? heuristic.heuristicQuestions
        : []

    const questionSummaries = questionDefinitions.map(
      (question, questionIndex) => {
        const questionAnswers = evaluatorHeuristics.map(
          (answer) => answer?.heuristicQuestions?.[questionIndex] || null,
        )
        const values = questionAnswers
          .map((answer) => getNumber(answer?.heuristicAnswer?.value, NaN))
          .filter((value) => Number.isFinite(value))

        const warnings = questionAnswers.filter(
          (answer) => answer?.heuristicAnswer?.warning === true,
        ).length
        const noAplica = questionAnswers.filter(
          (answer) => classifyQuestionResponse(answer) === 'noAplica',
        ).length
        const images = questionAnswers.reduce(
          (total, answer) =>
            total +
            (Array.isArray(answer?.images)
              ? answer.images.length
              : answer?.answerImageUrl
                ? 1
                : 0),
          0,
        )
        const commentDetails = []
        questionAnswers.forEach((answer, answerIndex) => {
          if (!answer) return
          const evaluatorName = getEvaluatorLabel(
            evaluatorHeuristics[answerIndex],
            answerIndex,
          )
          const texts = getQuestionCommentTexts(answer)
          texts.forEach(({ text }) => {
            commentDetails.push({ evaluatorName, text, questionIndex: questionIndex + 1 })
          })
        })
        const comments = commentDetails.length
        const average = values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0

        const averagePercentage =
          maxQuestionScore > 0 ? (average / maxQuestionScore) * 100 : 0

        return {
          title: getQuestionLabel(question, questionIndex),
          values,
          average,
          averagePercentage,
          evaluatorCount: values.length,
          warnings,
          noAplica,
          images,
          comments,
          commentDetails,
        }
      },
    )

    const heuristicStat =
      heuristicsStatistics.find(
        (item) =>
          item.name === getHeuristicShortTitle(heuristic, heuristicIndex),
      ) ||
      heuristicsStatistics[heuristicIndex] ||
      {}

    const calculatedPercentage = calculateHeuristicCompliance(
      evaluatorHeuristics,
      maxQuestionScore,
    )
    const percentage = Number.isFinite(calculatedPercentage)
      ? calculatedPercentage
      : getNumber(heuristicStat.percentage)

    const sdFromStats = getNumber(heuristicStat.sd, Number.NaN)
    const responseValues = questionSummaries.flatMap((item) => item.values)
    const sdCalculated = calcStandardDeviation(responseValues)
    const sd =
      Number.isFinite(sdFromStats) && sdFromStats > 0
        ? sdFromStats
        : sdCalculated

    const maxPoints = getNumber(heuristicStat.max)
    const minPoints = getNumber(heuristicStat.min)
    const totalWarnings = questionSummaries.reduce(
      (total, item) => total + item.warnings,
      0,
    )
    const totalNoAplica = questionSummaries.reduce(
      (total, item) => total + (item.noAplica || 0),
      0,
    )
    const totalImages = questionSummaries.reduce(
      (total, item) => total + item.images,
      0,
    )
    const totalComments = questionSummaries.reduce(
      (total, item) => total + item.comments,
      0,
    )
    const responseAverage = responseValues.length
      ? responseValues.reduce((sum, value) => sum + value, 0) /
        responseValues.length
      : 0
    const responseMin = responseValues.length ? Math.min(...responseValues) : 0
    const responseMax = responseValues.length ? Math.max(...responseValues) : 0
    const responseSpread = responseMax - responseMin
    const completionGap = Math.max(0, 100 - percentage)
    const warningWeight = 1 + Math.min(0.45, totalWarnings * 0.08)
    const evidenceWeight =
      1 + Math.min(0.18, totalComments * 0.03 + totalImages * 0.02)
    const domainWeight = getHeuristicDomainWeight(
      getHeuristicShortTitle(heuristic, heuristicIndex),
    )
    const impactScore =
      completionGap * warningWeight * evidenceWeight * domainWeight

    const questionAverages = questionSummaries.map((item) => item.average)
    const questionAverageMean = questionAverages.length
      ? questionAverages.reduce((sum, value) => sum + value, 0) /
        questionAverages.length
      : 0
    const questionAverageMeanPercentage =
      maxQuestionScore > 0 ? (questionAverageMean / maxQuestionScore) * 100 : 0

    const heuristicEvaluatorCount = questionSummaries.length
      ? Math.max(...questionSummaries.map((item) => item.evaluatorCount || 0))
      : 0

    return {
      id: heuristic?.heuristicId || `H${heuristicIndex + 1}`,
      position: heuristicIndex + 1,
      label: getHeuristicLabel(heuristic, heuristicIndex),
      title: getHeuristicShortTitle(heuristic, heuristicIndex),
      percentage,
      questionAverageMean,
      questionAverageMeanPercentage,
      evaluatorCount: heuristicEvaluatorCount,
      maxPoints,
      minPoints,
      sd,
      totalWarnings,
      totalNoAplica,
      totalImages,
      totalComments,
      questionSummaries,
      responseAverage,
      responseMin,
      responseMax,
      responseSpread,
      impactScore,
      severity: getSeverityLabelFromPercentage(percentage),
      comments: (() => {
        const heuComments = findHeuristicComments(
          heuristicComments,
          heuristic,
          heuristicIndex,
        )
        if (!heuComments) return ''
        if (typeof heuComments === 'string')
          return normalizeText(stripHtml(heuComments))
        if (typeof heuComments === 'object') {
          return Object.values(heuComments)
            .filter((t) => t && String(t).trim().length > 0)
            .map((t) => normalizeText(stripHtml(String(t))))
            .join('\n')
        }
        return ''
      })(),
      perQuestionComments: (() => {
        const heuComments = findHeuristicComments(
          heuristicComments,
          heuristic,
          heuristicIndex,
        )
        if (!heuComments || typeof heuComments !== 'object') return {}
        return heuComments
      })(),
    }
  })

  return {
    heuristics,
    orderedByPercentage: [...heuristics].sort(
      (left, right) => left.percentage - right.percentage,
    ),
    orderedByImpact: [...heuristics].sort(
      (left, right) => right.impactScore - left.impactScore,
    ),
  }
}

export { buildHeuristicEvidence, findHeuristicComments }
export default buildHeuristicEvidence
