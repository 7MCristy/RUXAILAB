/* eslint-disable no-console */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatTimeSpentFromMs, finalResultData } from '@/ux/Heuristic/utils/statistics'

const FONT = 'helvetica'
const M = 52
const PAGE_W = 595.28
const PAGE_H = 841.89
const CONTENT_W = PAGE_W - M * 2
const LH = 14
const COLORS = {
  text: [34, 34, 34],
  sub: [120, 120, 120],
  accent: [38, 50, 56],
  tableHead: [38, 50, 56],
  zebra: [246, 246, 246],
  border: [230, 230, 230],
  white: [255, 255, 255],
  green: [111, 175, 148],
  yellow: [196, 160, 60],
  red: [180, 70, 60],
}
const SEVERITY_COLORS = {
  Leve: [111, 175, 148],
  Moderado: [196, 160, 60],
  Grave: [219, 136, 40],
  Crítico: [180, 70, 60],
}

function loadLogo(url, maxHeight) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const aspect = img.width / img.height
        const w = maxHeight * aspect
        resolve({ img, width: w, height: maxHeight })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function addFooter(doc, pageNum) {
  const y = PAGE_H - 20
  doc.setFont(FONT, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.sub)
  doc.text(
    `INFORME DE EVALUACION HEURISTICA - Pag. ${pageNum}`,
    PAGE_W / 2,
    y,
    { align: 'center' },
  )
}

function getSeverityFromPercentage(value) {
  const n = getNumber(value, Number.NaN)
  if (!Number.isFinite(n)) return 'Crítico'
  if (n >= 75) return 'Leve'
  if (n >= 50) return 'Moderado'
  if (n >= 25) return 'Grave'
  return 'Crítico'
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCommentTexts(answer) {
  const comments = []
  if (Array.isArray(answer?.comments)) {
    comments.push(...answer.comments)
  }
  const legacyComment = normalizeText(answer?.heuristicComment)
  if (legacyComment) {
    comments.push(legacyComment)
  }
  return comments
    .map((comment) => {
      if (typeof comment === 'string') return normalizeText(comment)
      return normalizeText(comment?.text || comment)
    })
    .filter(Boolean)
}

function getNumber(value, fallback = 0) {
  const numericValue = Number.parseFloat(
    String(value ?? '')
      .replace('%', '')
      .replace(',', '.'),
  )
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function getHeuristicLabel(heuristic, index) {
  const id = heuristic?.heuristicId || `H${index + 1}`
  const title = normalizeText(heuristic?.heuristicTitle || heuristic?.title)
  return title ? `${id} - ${title}` : id
}

function getHeuristicShortTitle(heuristic, index) {
  return (
    normalizeText(heuristic?.heuristicTitle || heuristic?.title) ||
    `Heuristica ${index + 1}`
  )
}

function getEvaluatorLabel(item, index) {
  return (
    normalizeText(item?.name) ||
    normalizeText(item?.evaluator) ||
    normalizeText(item?.userDocId) ||
    `Ev${index + 1}`
  )
}

function getQuestionLabel(question, index) {
  const title = normalizeText(question?.title)
  const text = normalizeText(question?.text)
  if (title && text && title !== text) return `${index + 1}. ${title} - ${text}`
  if (title) return `${index + 1}. ${title}`
  if (text) return `${index + 1}. ${text}`
  return `${index + 1}. Pregunta sin titulo`
}

function getHeuristicDomainWeight(title) {
  const normalized = normalizeText(title).toLowerCase()
  if (
    /(color|legibilidad|estetico|minimalista|visual|apariencia|tipograf|estilo)/i.test(
      normalized,
    )
  ) {
    return 0.82
  }
  if (
    /(ayuda|documentaci[oó]n|error|errores|prevenci[oó]n|guardar|latencia|estado|consistencia|control|memoria|autonom[ií]a|met[aá]foras|flexibilidad)/i.test(
      normalized,
    )
  ) {
    return 1.12
  }
  return 1
}

function getHeuristicPurposeText(title) {
  const normalized = normalizeText(title).toLowerCase()
  if (/visibilidad|estado/.test(normalized)) {
    return 'Comprueba si el sistema informa su estado, progreso y resultados de forma continua para evitar incertidumbre durante la ejecucion de tareas.'
  }
  if (/relaci|mundo real|lenguaje/.test(normalized)) {
    return 'Evalua si la interfaz utiliza lenguaje y conceptos familiares para las personas usuarias, reduciendo interpretaciones ambiguas.'
  }
  if (/control|libertad|volver|deshacer/.test(normalized)) {
    return 'Analiza si la persona usuaria puede avanzar, retroceder o corregir decisiones con facilidad, sin quedarse bloqueada en el flujo.'
  }
  if (/consistencia|est[aá]ndar/.test(normalized)) {
    return 'Valida la coherencia entre etiquetas, componentes y comportamientos para evitar cambios inesperados entre pantallas.'
  }
  if (/error|prevenci/.test(normalized)) {
    return 'Revisa la capacidad de prevenir errores y de guiar decisiones seguras antes de que se produzcan incidencias.'
  }
  if (/reconocimiento|memoria/.test(normalized)) {
    return 'Mide si la interfaz reduce la carga de memoria manteniendo visible la informacion relevante y las opciones disponibles.'
  }
  if (/flexibilidad|eficiencia|atajo/.test(normalized)) {
    return 'Examina la eficiencia operativa para perfiles noveles y expertos, incluyendo recorridos optimizados y acciones frecuentes.'
  }
  if (/est[eé]tico|minimalista|visual|legibilidad|color/.test(normalized)) {
    return 'Evalua la calidad visual y legibilidad para facilitar comprension rapida, jerarquia clara y reduccion de ruido en pantalla.'
  }
  if (/recuperaci[oó]n|diagnosticar|mensajes/.test(normalized)) {
    return 'Analiza la claridad de mensajes de error y la facilidad para recuperar el flujo sin perdida de contexto.'
  }
  if (/ayuda|documentaci[oó]n/.test(normalized)) {
    return 'Valida la disponibilidad de ayuda util y accesible para resolver dudas puntuales sin interrumpir el trabajo principal.'
  }
  return 'Evalua la calidad de uso para detectar fricciones, reducir errores y mejorar eficacia, eficiencia y satisfaccion de las personas usuarias.'
}

// ─── QUALITATIVE HELPERS ────────────────────────────────────────────────────

function getQuestionQualitativeLabel(average, max = 1) {
  const ratio = max > 0 ? average / max : 0
  if (ratio === 0)
    return 'No cumplido: ningún evaluador confirmó este criterio.'
  if (ratio < 0.35)
    return 'Cumplimiento muy bajo: la mayoría de evaluadores detectaron ausencia o fallo claro.'
  if (ratio < 0.6)
    return 'Cumplimiento parcial: los evaluadores mostraron opiniones divididas sobre este criterio.'
  if (ratio < 0.85)
    return 'Cumplimiento mayoritario: se cumple en general pero con excepciones observadas.'
  return 'Cumplimiento sólido: todos o la gran mayoría de evaluadores confirmaron este criterio.'
}

function buildNegativeImpact(item) {
  const weakQuestions = item.questionSummaries.filter((q) => q.average < 0.5)
  const isVisual = /(color|legibilidad|estético|minimalista|visual)/i.test(
    item.title,
  )
  const hasManyWeak = weakQuestions.length >= 3

  if (weakQuestions.length === 0) {
    return 'No se identifican impactos negativos significativos en esta heurística. Los criterios evaluados muestran un nivel de cumplimiento aceptable.'
  }

  const weakTitles = weakQuestions
    .slice(0, 2)
    .map((q) =>
      q.title
        .replace(/^\d+\.\s*/, '')
        .split(' — ')[0]
        .substring(0, 60),
    )
    .join(' y ')

  if (isVisual) {
    return `Los criterios con bajo cumplimiento en esta heurística —especialmente "${weakTitles}"— afectan directamente a la comprensión visual y a la jerarquía de la interfaz. Aunque el impacto funcional suele ser más limitado que en heurísticas de flujo, la acumulación de problemas visuales incrementa la carga cognitiva del usuario, dificulta la lectura rápida y puede generar una percepción de baja calidad del producto.`
  }

  if (hasManyWeak) {
    return `Varios criterios clave presentan cumplimiento bajo o nulo, entre ellos "${weakTitles}". Esto introduce fricción directa en la ejecución de tareas: el usuario debe compensar con mayor esfuerzo, aumenta la probabilidad de errores y se reduce la confianza en el sistema. En escenarios de uso repetido, esta fricción tiende a generar abandono o búsqueda de alternativas.`
  }

  return `El criterio "${weakTitles}" presenta un nivel de cumplimiento bajo que puede generar confusión puntual o requerir pasos adicionales por parte del usuario. Aunque el impacto no bloquea el flujo completo, introduce una fricción que puede afectar la percepción global de la experiencia.`
}

function buildPositiveImpact(item) {
  const weakQuestions = item.questionSummaries.filter((q) => q.average < 0.5)
  const isVisual = /(color|legibilidad|estético|minimalista|visual)/i.test(
    item.title,
  )

  if (weakQuestions.length === 0) {
    return 'Mantener el nivel actual de cumplimiento en esta heurística contribuye a una experiencia consistente y predecible. Realizar revisiones periódicas evitará regresiones en futuras iteraciones del diseño.'
  }

  if (isVisual) {
    return 'Resolver los criterios visuales identificados mejoraría la legibilidad, reforzaría la jerarquía de la interfaz y aumentaría la percepción de calidad del producto. La ganancia sería gradual y acumulativa: cada mejora visual reduce la carga cognitiva del usuario y mejora la accesibilidad global del sistema.'
  }

  if (weakQuestions.length >= 3) {
    return 'Abordar los criterios con bajo cumplimiento en esta heurística tendría un impacto alto y directo sobre la experiencia: reduciría los errores de usuario, simplificaría las decisiones durante la navegación y aumentaría la eficiencia de uso desde las primeras interacciones. Dado que afecta a múltiples criterios del flujo principal, la mejora beneficiaría tanto a usuarios nuevos como a usuarios recurrentes.'
  }

  return 'Mejorar el criterio o criterios señalados aliviaría los puntos de fricción identificados y estabilizaría la experiencia en esta dimensión. El beneficio sería perceptible de forma inmediata para los usuarios que transiten por los flujos afectados.'
}

// ─── CELL COLOR HELPERS ──────────────────────────────────────────────────────

function formatDecimal(value, digits = 2) {
  const numericValue = getNumber(value, Number.NaN)
  if (!Number.isFinite(numericValue)) {
    return `0,${'0'.repeat(digits)}`
  }
  return numericValue.toFixed(digits).replace('.', ',')
}

function getHeuristicsCellColor(value, max, min) {
  const numericValue = getNumber(value, 0)
  const numericMax = Number(max)
  const numericMin = Number(min)

  if (!Number.isFinite(numericMax) || !Number.isFinite(numericMin)) {
    return { fill: [238, 238, 238], text: [119, 119, 119] }
  }
  if (numericMax === numericMin) {
    if (numericValue === 0)
      return { fill: [253, 229, 226], text: [255, 42, 26] }
    if (numericValue > 0) return { fill: [229, 243, 232], text: [37, 168, 58] }
    return { fill: [238, 238, 238], text: [119, 119, 119] }
  }

  const normalized = (numericValue - numericMin) / (numericMax - numericMin)
  if (normalized < 0.25) return { fill: [253, 229, 226], text: [255, 42, 26] }
  if (normalized < 0.5) return { fill: [255, 239, 217], text: [255, 133, 0] }
  if (normalized < 0.75) return { fill: [255, 248, 220], text: [255, 208, 0] }
  return { fill: [229, 243, 232], text: [37, 168, 58] }
}

function getContrastingTextColor(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return COLORS.text
  const [r, g, b] = rgb
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness < 128 ? COLORS.white : COLORS.text
}

function parseMmSsToMs(value) {
  const text = normalizeText(value)
  if (!text || !text.includes(':')) return 0
  const [minutes = '0', seconds = '0'] = text.split(':')
  const m = Number(minutes)
  const s = Number(seconds)
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0
  return (m * 60 + s) * 1000
}

function getTimeColor(valueMs, maxMs) {
  if (
    !Number.isFinite(valueMs) ||
    valueMs <= 0 ||
    !Number.isFinite(maxMs) ||
    maxMs <= 0
  ) {
    return { fill: [245, 245, 245], text: [90, 90, 90] }
  }
  const ratio = valueMs / maxMs
  if (ratio < 0.33) return { fill: [229, 243, 232], text: [30, 125, 50] }
  if (ratio < 0.66) return { fill: [255, 248, 220], text: [163, 126, 0] }
  return { fill: [255, 239, 217], text: [176, 96, 0] }
}

function getMaxQuestionScore(testOptions = []) {
  const values = Array.isArray(testOptions)
    ? testOptions
        .map((item) => getNumber(item?.value, Number.NaN))
        .filter((value) => Number.isFinite(value))
    : []
  return values.length ? Math.max(...values) : 0
}

function calculateHeuristicCompliance(
  evaluatorHeuristics = [],
  maxQuestionScore,
) {
  const evaluatorPercentages = evaluatorHeuristics
    .map((heuristicAnswer) => {
      const values = (heuristicAnswer?.heuristicQuestions || [])
        .map((questionAnswer) =>
          getNumber(questionAnswer?.heuristicAnswer?.value, Number.NaN),
        )
        .filter((value) => Number.isFinite(value))
      const maxPossible = values.length * maxQuestionScore
      if (!values.length || maxPossible <= 0) return Number.NaN
      const total = values.reduce((sum, value) => sum + value, 0)
      return (total * 100) / maxPossible
    })
    .filter((value) => Number.isFinite(value))

  if (!evaluatorPercentages.length) return Number.NaN
  return (
    evaluatorPercentages.reduce((sum, value) => sum + value, 0) /
    evaluatorPercentages.length
  )
}

// Calculates standard deviation from an array of numbers
function calcStandardDeviation(values) {
  if (!values || values.length < 2) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function buildHeuristicEvidence({
  allAnswers = [],
  testStructure = [],
  finalResultData = {},
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
          extractCommentTexts(answer).forEach((text) => {
            commentDetails.push({ evaluatorName, text })
          })
        })
        const comments = commentDetails.length
        const average = values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0

        return {
          title: getQuestionLabel(question, questionIndex),
          values,
          average,
          warnings,
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

    // Standard deviation: prefer statistics data, fallback to calculating from question averages
    const sdFromStats = getNumber(heuristicStat.sd, Number.NaN)
    const responseValues = questionSummaries.flatMap((item) => item.values)
    const sdCalculated = calcStandardDeviation(responseValues)
    const sd =
      Number.isFinite(sdFromStats) && sdFromStats > 0
        ? sdFromStats
        : sdCalculated

    const averagePoints = getNumber(heuristicStat.average)
    const maxPoints = getNumber(heuristicStat.max)
    const minPoints = getNumber(heuristicStat.min)
    const totalWarnings = questionSummaries.reduce(
      (total, item) => total + item.warnings,
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
    
    return {
      id: heuristic?.heuristicId || `H${heuristicIndex + 1}`,
      position: heuristicIndex + 1,
      label: getHeuristicLabel(heuristic, heuristicIndex),
      title: getHeuristicShortTitle(heuristic, heuristicIndex),
      percentage,
      averagePoints,
      maxPoints,
      minPoints,
      sd,
      totalWarnings,
      totalImages,
      totalComments,
      questionSummaries,
      responseAverage,
      responseMin,
      responseMax,
      responseSpread,
      impactScore,
      severity: getSeverityFromPercentage(percentage),
      comments: normalizeText(
        heuristicComments?.[
          heuristic?.heuristicId || `H${heuristicIndex + 1}`
        ] || '',
      ),
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

export async function generateHeuristicPdf(reportData, options = {}) {
  console.log(
    '[generateHeuristicPdf] reportData keys:',
    Object.keys(reportData || {}),
  )

  const {
    testTitle,
    testDescription,
    testUrl,
    evaluatorPercentages,
    heuristicsEvaluator: rawHeuristicsEvaluator,
    heuristicsStatistics: rawHeuristicsStatistics,
    statisticsByHeuristics,
    finalResultData: finalResultData,
    heuristicComments,
    studyConclusion,
    testStructure,
    allOptions,
    allAnswers,
    statisticsTable,
    statisticsByEvaluatorAnswer,
    timeByHeuristics,
  } = reportData
  const mode = options?.mode || 'download'

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DEBUG: finalResultData
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('[generateHeuristicPdf] finalResultData:', finalResultData)
  console.log(
    '[generateHeuristicPdf] finalResultData keys:',
    finalResultData ? Object.keys(finalResultData) : 'null',
  )
  console.log(
    '[generateHeuristicPdf] finalResultData.sd:',
    finalResultData?.sd,
  )
  console.log(
    '[generateHeuristicPdf] finalResultData.min:',
    finalResultData?.min,
  )
  console.log(
    '[generateHeuristicPdf] finalResultData.max:',
    finalResultData?.max,
  )
  console.log(
    '[generateHeuristicPdf] finalResultData.average:',
    finalResultData?.average,
  )

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const logo = await loadLogo('/brand/logo_full.png', 30)

  const heuristicsEvaluator =
    rawHeuristicsEvaluator ||
    (statisticsByEvaluatorAnswer?.header && statisticsByEvaluatorAnswer?.items
      ? statisticsByEvaluatorAnswer
      : null)
  const heuristicsStatistics =
    rawHeuristicsStatistics ||
    (statisticsByHeuristics?.header && statisticsByHeuristics?.items
      ? statisticsByHeuristics
      : null)
  const heuristicStatsItems = Array.isArray(heuristicsStatistics?.items)
    ? heuristicsStatistics.items
    : []
  const heuristicMatrixItems = Array.isArray(heuristicsEvaluator?.items)
    ? heuristicsEvaluator.items
    : []
  const evaluatorSummaryItems = Array.isArray(evaluatorPercentages?.items)
    ? evaluatorPercentages.items
    : []
  const evaluatorTimeItems = Array.isArray(statisticsTable?.items)
    ? statisticsTable.items
    : Array.isArray(statisticsByEvaluatorAnswer)
      ? statisticsByEvaluatorAnswer
      : []

  const evidence = buildHeuristicEvidence({
    allAnswers: Array.isArray(allAnswers) ? allAnswers : [],
    testStructure: Array.isArray(testStructure) ? testStructure : [],
    finalResultData: finalResultData || {},
    heuristicsStatistics: heuristicStatsItems,
    heuristicComments: heuristicComments || {},
    testOptions: allOptions,
  })

  const globalPct = normalizeText(
    finalResultData?.average ||
      `${evaluatorPercentages?.globalAverage || '0.00'}%`,
  )
  const globalSeverity = getSeverityFromPercentage(globalPct)
  const averageTime = formatTimeSpentFromMs(
    finalResultData?.averageTimeMs || 0,
  )
  const totalComments = getNumber(finalResultData?.totalComments || 0)
  const totalImages = getNumber(finalResultData?.totalImages || 0)
  const totalWarnings = evidence.heuristics.reduce(
    (sum, item) => sum + item.totalWarnings,
    0,
  )

  // Global SD from statistics (string like "2.34" or "2.34%")
  const globalSd = normalizeText(finalResultData?.sd || '0.00')
  const globalMax = normalizeText(finalResultData?.max || '0.00')
  const globalMin = normalizeText(finalResultData?.min || '0.00')

  console.log('[generateHeuristicPdf] EXTRACTED GLOBAL VALUES:')
  console.log('[generateHeuristicPdf] globalPct:', globalPct)
  console.log('[generateHeuristicPdf] globalSd:', globalSd)
  console.log('[generateHeuristicPdf] globalMax:', globalMax)
  console.log('[generateHeuristicPdf] globalMin:', globalMin)
  console.log('[generateHeuristicPdf] globalSeverity:', globalSeverity)

  let pageNum = 1
  let y = M
  const tocEntries = []

  const addPageHeader = () => {
    addFooter(doc, pageNum)
  }

  const ensureSpace = (needed) => {
    if (y + needed > PAGE_H - M) {
      doc.addPage()
      pageNum += 1
      y = M
      addPageHeader()
    }
  }

  const startSection = (title, size = 18) => {
    const lh = size + 4
    doc.setFont(FONT, 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...COLORS.accent)
    const titleLines = doc.splitTextToSize(title, CONTENT_W)
    ensureSpace(titleLines.length * lh + 20)
    tocEntries.push({ title, page: pageNum })
    doc.text(titleLines, M, y)
    y += titleLines.length * lh
    doc.setDrawColor(...COLORS.accent)
    doc.setLineWidth(0.4)
    const lineLen = Math.min(size * 3.5, CONTENT_W * 0.4)
    doc.line(M, y, M + lineLen, y)
    y += size === 18 ? 22 : 18
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.text)
  }

  const writeParagraph = (text, opts = {}) => {
    const lh = opts.lineHeight || LH
    const x = opts.x || M
    const width = opts.width || CONTENT_W
    doc.setFont(FONT, opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 11)
    doc.setTextColor(...(opts.color || COLORS.text))
    const lines = doc.splitTextToSize(normalizeText(text), width)
    const fontSize = doc.getFontSize()
    const scaleFactor = doc.internal.scaleFactor
    const getTextWidth = (t) =>
      (doc.getStringUnitWidth(t) * fontSize) / scaleFactor

    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lh + 4)
      const line = lines[i]
      const isLastLine = i === lines.length - 1

      if (isLastLine) {
        // Last line of paragraph: always left-aligned
        doc.text(line, x, y, { align: 'left' })
      } else {
        // Every other line: justify by distributing space between words
        const words = line.split(' ').filter(Boolean)
        if (words.length <= 1) {
          doc.text(line, x, y, { align: 'left' })
        } else {
          const wordsWidth = words.reduce((sum, w) => sum + getTextWidth(w), 0)
          const availableSpace = width - wordsWidth
          const spaceWidth = availableSpace / (words.length - 1)
          // Skip justification if gaps would be too wide (short last-ish lines)
          if (spaceWidth > 18 || words.length < 4) {
            doc.text(line, x, y, { align: 'left' })
          } else {
            let cx = x
            words.forEach((word) => {
              doc.text(word, cx, y)
              cx += getTextWidth(word) + spaceWidth
            })
          }
        }
      }
      y += lh
    }

    y += opts.spacing || 6
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.text)
  }

  // ─── PORTADA ──────────────────────────────────────────────────────────────
  if (logo) {
    doc.addImage(
      logo.img,
      'PNG',
      PAGE_W / 2 - logo.width / 2,
      y,
      logo.width,
      logo.height,
    )
    y += logo.height + 28
  }

  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.8)
  doc.line(M + 60, y, PAGE_W - M - 60, y)
  y += 32

  doc.setFont(FONT, 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...COLORS.accent)
  doc.text('INFORME DE EVALUACION', PAGE_W / 2, y, { align: 'center' })
  y += 22
  doc.text('HEURISTICA', PAGE_W / 2, y, { align: 'center' })
  y += 36

  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.4)
  doc.line(M + 100, y, PAGE_W - M - 100, y)
  y += 28

  doc.setFont(FONT, 'normal')
  doc.setFontSize(15)
  doc.setTextColor(...COLORS.text)
  const titleLines = doc.splitTextToSize(
    testTitle || 'Sistema evaluado',
    CONTENT_W,
  )
  doc.text(titleLines, PAGE_W / 2, y, { align: 'center' })
  y += titleLines.length * 22 + 8

  if (testUrl) {
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.sub)
    const urlLines = doc.splitTextToSize(testUrl, CONTENT_W)
    doc.text(urlLines, PAGE_W / 2, y, { align: 'center' })
    y += urlLines.length * 16 + 8
  }

  doc.setFontSize(10)
  doc.setTextColor(...COLORS.sub)
  const evaluatorLabels = evaluatorTimeItems
    .map((item, index) => getEvaluatorLabel(item, index))
    .filter(Boolean)
    .join(' · ')
  if (evaluatorLabels) {
    const evalLines = doc.splitTextToSize(
      `Evaluadores: ${evaluatorLabels}`,
      CONTENT_W,
    )
    doc.text(evalLines, PAGE_W / 2, y, { align: 'center' })
    y += evalLines.length * 16 + 6
  }
  doc.text(
    'Metodologia: 15 Heuristicas de Usabilidad - Nielsen + ISO 9241-110',
    PAGE_W / 2,
    y,
    { align: 'center' },
  )

  y = PAGE_H - M
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.sub)
  doc.text('RUXAILAB - Informe generado automaticamente', PAGE_W / 2, y, {
    align: 'center',
  })

  // ─── INDICE ───────────────────────────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  doc.setFont(FONT, 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...COLORS.accent)
  doc.text('INDICE', M, y)
  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.5)
  doc.line(M, y + 4, M + 60, y + 4)
  y += 28

  // ─── 1. INTRODUCCION ─────────────────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('1. Introduccion')

  writeParagraph(
    `Este informe recoge los resultados de la evaluacion heuristica realizada al sistema "${testTitle || 'Sistema evaluado'}".`,
  )
  if (testDescription) {
    writeParagraph(testDescription)
  }
  writeParagraph(
    `La evaluacion ha sido completada por ${evaluatorTimeItems.length || evaluatorSummaryItems.length || 0} evaluador(es) y se apoya en el promedio de respuestas, los avisos de warning, los comentarios y las evidencias visuales recogidas durante el test.`,
  )
  writeParagraph(
    `El resultado global de la evaluacion se interpreta como ${globalSeverity}, con un promedio de cumplimiento entre evaluadores del ${Number(getNumber(evaluatorPercentages?.globalAverage || 0)).toFixed(2)}%. Este dato se calcula sumando los porcentajes individuales de cumplimiento y dividiendo entre el numero total de evaluadores.`,
  )
  // SD global — shown here, "escenarios de warning maximo/minimo" removed
  console.log(
    '[generateHeuristicPdf] About to write SD paragraph with values:',
    { globalSd, globalMax, globalMin },
  )
  writeParagraph(
    `La desviacion estandar global de las puntuaciones es ${globalSd}, lo que refleja el grado de consenso entre los evaluadores: valores bajos indican alta coincidencia y valores altos señalan mayor divergencia en la percepcion de la usabilidad del sistema. El valor maximo (${globalMax}) corresponde al mayor porcentaje de cumplimiento obtenido por un evaluador, mientras que el valor minimo (${globalMin}) corresponde al menor porcentaje de cumplimiento obtenido por otro evaluador.`,
  )
  if (totalWarnings > 0 || totalComments > 0 || totalImages > 0) {
    const metadataBits = []
    if (totalWarnings > 0)
      metadataBits.push(`${totalWarnings} respuesta(s) con warning`)
    if (totalComments > 0) metadataBits.push(`${totalComments} comentario(s)`)
    if (totalImages > 0) metadataBits.push(`${totalImages} imagen(es)`)
    writeParagraph(
      `La evaluacion general incorpora ${metadataBits.join(', ')}.`,
    )
  }

  // ─── 2. RESUMEN EJECUTIVO ─────────────────────────────────────────────────
  startSection('2. Resumen ejecutivo')
  writeParagraph(
    'La tabla siguiente muestra el porcentaje global de cumplimiento obtenido por cada evaluador. El valor se calcula a partir de las respuestas aplicables y permite comparar la percepcion general de usabilidad entre participantes.',
  )

  const evaluatorRows = evaluatorSummaryItems.map((item, index) => {
    const percentage = getNumber(item?.percentage)
    return [
      item?.name || getEvaluatorLabel(item, index),
      `${formatDecimal(percentage)}%`,
    ]
  })

  if (evaluatorRows.length) {
    evaluatorRows.push([
      'MEDIA GLOBAL',
      `${formatDecimal(evaluatorPercentages?.globalAverage)}%`,
    ])
    ensureSpace(60)
    autoTable(doc, {
      startY: y,
      head: [['Evaluador', '% Cumplimiento']],
      body: evaluatorRows,
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white },
      alternateRowStyles: { fillColor: COLORS.zebra },
      margin: { left: M, right: M },
      theme: 'grid',
      didParseCell(data) {
        if (data.section !== 'body') return
        if (data.column.index === 1) {
          const percentage = getNumber(data.cell.raw)
          const severity = getSeverityFromPercentage(percentage)
          const color = SEVERITY_COLORS[severity] || COLORS.zebra
          data.cell.styles.fillColor = color
          data.cell.styles.textColor = getContrastingTextColor(color)
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
    y = doc.lastAutoTable.finalY + 18
  }

  // ─── 3. PRIORIDAD DE MEJORA ───────────────────────────────────────────────
  startSection('3. Prioridad de mejora por impacto negativo')
  writeParagraph(
    'La priorizacion combina el porcentaje de cumplimiento con las senales de riesgo recogidas durante la evaluacion, como warnings, comentarios y evidencias visuales.',
  )
  writeParagraph(
    'La tabla siguiente presenta el cumplimiento calculado por heuristica. Para cada evaluador se suman las puntuaciones de las preguntas aplicables, se multiplican por 100 y se dividen entre el numero de preguntas aplicables multiplicado por la puntuacion maxima. Despues se promedian esos porcentajes entre evaluadores.',
  )

  const summaryRows = evidence.orderedByPercentage.map((item) => [
    item.position,
    item.label,
    `${formatDecimal(item.percentage)}%`,
    item.severity,
  ])

  autoTable(doc, {
    startY: y,
    head: [['#', 'Heuristica', '% Cumplimiento', 'Severidad']],
    body: summaryRows,
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white },
    alternateRowStyles: { fillColor: COLORS.zebra },
    margin: { left: M, right: M },
    theme: 'grid',
    didParseCell(data) {
      if (data.section !== 'body') return
      if (data.column.index === 2) {
        const severity = data.row.raw?.[3]
        const color = SEVERITY_COLORS[severity] || COLORS.zebra
        data.cell.styles.fillColor = color
        data.cell.styles.textColor = getContrastingTextColor(color)
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.column.index === 3) {
        const color = SEVERITY_COLORS[data.cell.raw] || COLORS.zebra
        data.cell.styles.fillColor = color
        data.cell.styles.textColor = getContrastingTextColor(color)
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })
  y = doc.lastAutoTable.finalY + 18

  // ─── 4. ANALISIS DETALLADO ────────────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('4. Analisis detallado por heuristica')

  evidence.orderedByImpact.forEach((item) => {
    ensureSpace(110)

    // Title + severity badge (keep percentage here as it's the section identifier)
    writeParagraph(item.label, { bold: true, size: 13, spacing: 2 })
    writeParagraph(
      `Nivel: ${item.severity}  |  Desviacion tipica: ${formatDecimal(item.sd)}`,
      {
        bold: false,
        size: 10,
        color: SEVERITY_COLORS[item.severity] || COLORS.sub,
        spacing: 6,
      },
    )

    const heuristicTitle = getHeuristicShortTitle(
      { heuristicTitle: item.title },
      0,
    )
    const purposeText = getHeuristicPurposeText(heuristicTitle)

    writeParagraph(`Esta heuristica evalua: ${purposeText}`, {
      size: 10,
      spacing: 6,
    })

    // ── Criterio a criterio ──────────────────────────────────────────────
    if (item.questionSummaries.length > 0) {
      writeParagraph('Analisis por criterio evaluado:', {
        bold: true,
        size: 10,
        spacing: 3,
      })

      item.questionSummaries.forEach((q) => {
        ensureSpace(36)
        writeParagraph(`• ${q.title}`, {
          bold: true,
          size: 9,
          spacing: 1,
          x: M + 6,
          width: CONTENT_W - 6,
        })
        writeParagraph(getQuestionQualitativeLabel(q.average), {
          size: 9,
          spacing: 5,
          x: M + 14,
          width: CONTENT_W - 14,
          color: COLORS.sub,
        })
      })
    }

    // ── Desviacion tipica por heuristica ─────────────────────────────────
    // SD interpretation
    const sdValue = item.sd
    let sdInterpretation = ''
    if (sdValue < 0.2) {
      sdInterpretation = `La desviacion tipica de las respuestas en esta heuristica es baja (${formatDecimal(sdValue)}), lo que indica que los evaluadores coincidieron ampliamente en sus valoraciones.`
    } else if (sdValue < 0.5) {
      sdInterpretation = `La desviacion tipica es moderada (${formatDecimal(sdValue)}), lo que refleja cierta divergencia entre evaluadores en algunos criterios, aunque sin llegar a ser contradictoria.`
    } else {
      sdInterpretation = `La desviacion tipica es alta (${formatDecimal(sdValue)}), lo que señala una percepcion muy dispar entre evaluadores. Esto puede indicar que la experiencia varía notablemente según el perfil del usuario o el contexto de uso.`
    }
    writeParagraph(sdInterpretation, { size: 10, spacing: 5 })

    // ── Diagnostico global cualitativo ───────────────────────────────────
    const weakQuestions = item.questionSummaries.filter((q) => q.average < 0.5)
    const strongQuestions = item.questionSummaries.filter(
      (q) => q.average >= 0.85,
    )

    let globalDiagnosis = ''
    if (weakQuestions.length > item.questionSummaries.length / 2) {
      globalDiagnosis =
        'El diagnostico global de esta heuristica es desfavorable. La mayoria de los criterios evaluados presentan cumplimiento bajo o nulo, lo que indica que esta area representa una friccion real y consistente para el usuario. Se recomienda priorizar su revision en el siguiente ciclo de diseno.'
    } else if (strongQuestions.length > item.questionSummaries.length / 2) {
      globalDiagnosis =
        'El diagnostico global de esta heuristica es favorable. La mayoria de criterios evaluados obtienen confirmacion positiva por parte de los evaluadores, lo que indica que el sistema resuelve bien esta dimension de uso.'
    } else {
      globalDiagnosis =
        'El diagnostico global de esta heuristica es mixto. Conviven criterios bien resueltos con otros que presentan margen claro de mejora, lo que sugiere una implementacion parcial o inconsistente dentro del flujo.'
    }
    writeParagraph(globalDiagnosis, { size: 10, spacing: 5 })

    // ── Impacto negativo ─────────────────────────────────────────────────
    writeParagraph('Impacto negativo actual:', {
      bold: true,
      size: 10,
      spacing: 2,
    })
    writeParagraph(buildNegativeImpact(item), { size: 10, spacing: 5 })

    // ── Beneficio si mejora ──────────────────────────────────────────────
    writeParagraph('Beneficio esperado si se mejora:', {
      bold: true,
      size: 10,
      spacing: 2,
    })
    writeParagraph(buildPositiveImpact(item), { size: 10, spacing: 5 })

    // ── Metadata (warnings / images / comments) ──────────────────────────
    if (item.totalWarnings > 0) {
      writeParagraph(
        `Durante la evaluacion, ${item.totalWarnings} respuesta(s) fueron marcadas con warning, lo que refuerza la necesidad de revision especifica en los criterios senalados.`,
        { size: 9, color: COLORS.sub, spacing: 3 },
      )
    }
    if (item.totalImages > 0) {
      writeParagraph(
        `Se adjuntaron ${item.totalImages} evidencia(s) visual(es) que documentan los hallazgos de esta heuristica.`,
        { size: 9, color: COLORS.sub, spacing: 3 },
      )
    }
    if (normalizeText(item.comments)) {
      writeParagraph(`Comentarios de los evaluadores: ${item.comments}`, {
        size: 9,
        color: COLORS.sub,
        spacing: 3,
      })
    }

    y += 12
  })

  // ─── 5. COMPARATIVA POR EVALUADOR ────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('5. Comparativa de puntuaciones por evaluador')
  writeParagraph(
    'La matriz siguiente muestra los valores medios de respuesta por heuristica y evaluador. Los colores facilitan detectar respuestas bajas, medias y altas de forma visual.',
  )

  const matrixHeaders = Array.isArray(heuristicsEvaluator?.header)
    ? heuristicsEvaluator.header.map(
        (header) => header.title || header.text || header.value || '',
      )
    : []
  const heuristicNameByIndex = Array.isArray(testStructure)
    ? testStructure.map((heuristic, index) => {
        const heuristicId = normalizeText(
          heuristic?.id || heuristic?.heuristicId || `H${index + 1}`,
        )
        const heuristicTitle = normalizeText(
          heuristic?.title || heuristic?.heuristicTitle || heuristic?.name,
        )
        return heuristicTitle
          ? `${heuristicId} - ${heuristicTitle}`
          : heuristicId
      })
    : []
  const matrixRows = heuristicMatrixItems.map((item, rowIndex) => ({
    heuristic: heuristicNameByIndex[rowIndex] || item.heuristic || '—',
    max: Number(item.max),
    min: Number(item.min),
    values: matrixHeaders.map((_, index) => {
      if (index === 0)
        return heuristicNameByIndex[rowIndex] || item.heuristic || '—'
      const key = heuristicsEvaluator.header?.[index]?.value
      const val = item?.[key]
      return val != null ? formatDecimal(val) : '0,00'
    }),
  }))
  const matrixBody = matrixRows.map((row) => row.values)
  const heuristicColumnWidth = Math.max(190, Math.min(CONTENT_W * 0.44, 260))
  const evaluatorColumnCount = Math.max(1, matrixHeaders.length - 1)
  const evaluatorColumnWidth =
    (CONTENT_W - heuristicColumnWidth) / evaluatorColumnCount
  const matrixColumnStyles = {
    0: {
      halign: 'left',
      fontStyle: 'bold',
      textColor: COLORS.accent,
      cellWidth: heuristicColumnWidth,
      overflow: 'linebreak',
    },
  }
  for (let index = 1; index < matrixHeaders.length; index += 1) {
    matrixColumnStyles[index] = {
      halign: 'center',
      cellWidth: evaluatorColumnWidth,
    }
  }

  if (matrixHeaders.length > 1) {
    ensureSpace(40)
    autoTable(doc, {
      startY: y,
      head: [matrixHeaders],
      body: matrixBody,
      styles: {
        fontSize: 8,
        cellPadding: 5,
        halign: 'center',
        valign: 'middle',
      },
      columnStyles: matrixColumnStyles,
      headStyles: {
        fillColor: COLORS.tableHead,
        textColor: COLORS.white,
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [250, 252, 255] },
      tableWidth: CONTENT_W,
      margin: { left: M, right: M },
      theme: 'grid',
      didParseCell(data) {
        if (data.section !== 'body' || data.column.index === 0) return
        const row = matrixRows[data.row.index]
        const color = getHeuristicsCellColor(data.cell.raw, row?.max, row?.min)
        data.cell.styles.fillColor = color.fill
        data.cell.styles.textColor = color.text
        data.cell.styles.fontStyle = 'bold'
      },
    })
    y = doc.lastAutoTable.finalY + 18
  }

  writeParagraph(
    'La tabla siguiente muestra tiempos por heuristica, total y promedio por evaluador.',
  )

  const timeByHeuristicsHeader = Array.isArray(timeByHeuristics?.header)
    ? timeByHeuristics.header
    : []
  const timeByHeuristicsItems = Array.isArray(timeByHeuristics?.items)
    ? timeByHeuristics.items
    : []
  const filteredTimeHeader = timeByHeuristicsHeader.filter(
    (header) => (header?.value || '') !== 'timeSd',
  )
  const timeHeaderLabels = filteredTimeHeader.map(
    (header) => header?.title || header?.text || header?.value || '',
  )
  const timeRows = timeByHeuristicsItems.map((item) =>
    filteredTimeHeader.map((header) => {
      const key = header?.value
      return item?.[key] != null ? String(item[key]) : '—'
    }),
  )
  const maxTimeMs = Math.max(
    ...timeByHeuristicsItems.map((item) =>
      Math.max(
        parseMmSsToMs(item?.totalTime),
        parseMmSsToMs(item?.averageTime),
      ),
    ),
    0,
  )

  if (timeHeaderLabels.length > 1 && timeRows.length) {
    ensureSpace(40)
    autoTable(doc, {
      startY: y,
      head: [timeHeaderLabels],
      body: timeRows,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white },
      alternateRowStyles: { fillColor: COLORS.zebra },
      margin: { left: M, right: M },
      theme: 'grid',
      didParseCell(data) {
        if (data.section !== 'body' || data.column.index === 0) return
        const headerKey = filteredTimeHeader[data.column.index]?.value
        const rawMs = parseMmSsToMs(data.cell.raw)
        if (
          headerKey?.startsWith('Ev') ||
          headerKey === 'totalTime' ||
          headerKey === 'averageTime'
        ) {
          const color = getTimeColor(rawMs, maxTimeMs)
          data.cell.styles.fillColor = color.fill
          data.cell.styles.textColor = color.text
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
    y = doc.lastAutoTable.finalY + 16
  }

  writeParagraph(`Tiempo medio de ejecucion global: ${averageTime}.`)

  // ─── 6. CONCLUSION ────────────────────────────────────────────────────────
  startSection('6. Conclusion')
  if (studyConclusion) {
    writeParagraph(studyConclusion)
  }
  writeParagraph(
    `En conjunto, el informe muestra un cumplimiento global de ${globalPct}, con ${totalWarnings} warning(s), ${totalComments} comentario(s) y ${totalImages} imagen(es) registradas como evidencias.`,
  )
  writeParagraph(
    'Las heuristicas con peor posicion en el ranking de impacto son las que combinan bajo cumplimiento y senales de riesgo operativo, por lo que deben priorizarse en la hoja de ruta de mejora.',
  )

  // ─── INDICE (completar páginas reales) ───────────────────────────────────
  doc.setPage(2)
  let tocY = M + 28
  doc.setFont(FONT, 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.text)
  tocEntries.forEach((entry) => {
    if (tocY > PAGE_H - M) return
    const title = normalizeText(entry.title)
    const titleWidth =
      (doc.getStringUnitWidth(title) * doc.getFontSize()) /
      doc.internal.scaleFactor
    doc.text(title, M, tocY)
    const dotStart = M + titleWidth + 8
    const dotEnd = PAGE_W - M - 20
    if (dotEnd > dotStart) {
      const dots = '.'.repeat(
        Math.max(
          3,
          Math.floor(
            (dotEnd - dotStart) /
              ((doc.getStringUnitWidth('.') * doc.getFontSize()) /
                doc.internal.scaleFactor),
          ),
        ),
      )
      doc.text(dots, dotStart, tocY)
    }
    doc.text(String(entry.page), PAGE_W - M, tocY, { align: 'right' })
    tocY += 20
  })

  const fileName = `informe_heuristica_${
    testTitle ? testTitle.replace(/\s+/g, '_').toLowerCase() : 'evaluacion'
  }.pdf`

  if (mode === 'download') {
    doc.save(fileName)
    return { fileName }
  }

  if (mode === 'preview') {
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    return { fileName, blob, url }
  }

  const blob = doc.output('blob')
  return { fileName, blob }
}
