/* eslint-disable no-console */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatTimeSpentFromMs } from '@/ux/Heuristic/utils/statistics'
import { getStorage, ref, getBlob } from 'firebase/storage'

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
    `INFORME DE EVALUACIÓN HEURÍSTICA - Pág. ${pageNum}`,
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

function pluralize(count, singular, plural) {
  const n = Number(count)
  return n === 1 ? singular : plural
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCommentTexts(answer) {
  const comments = []
  if (Array.isArray(answer?.comments)) {
    comments.push(...answer.comments)
  }
  if (Array.isArray(answer?.heuristicAnswer?.comments)) {
    comments.push(...answer.heuristicAnswer.comments)
  }
  const legacyComment = normalizeText(answer?.heuristicComment)
  if (legacyComment) {
    comments.push(legacyComment)
  }
  const legacyNested = normalizeText(answer?.heuristicAnswer?.heuristicComment)
  if (legacyNested) {
    comments.push(legacyNested)
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
  return title ? `${id} — ${title}` : id
}

function getHeuristicShortTitle(heuristic, index) {
  return (
    normalizeText(heuristic?.heuristicTitle || heuristic?.title) ||
    `Heurística ${index + 1}`
  )
}

function getEvaluatorLabel(item, index) {
  return (
    normalizeText(item?.name) ||
    normalizeText(item?.evaluator) ||
    normalizeText(item?.email) ||
    normalizeText(item?.userDocId) ||
    `Ev${index + 1}`
  )
}

function getQuestionLabel(question, index) {
  const title = normalizeText(question?.title)
  const text = normalizeText(question?.text)
  if (title && text && title !== text) return `${index + 1}. ${title} — ${text}`
  if (title) return `${index + 1}. ${title}`
  if (text) return `${index + 1}. ${text}`
  return `${index + 1}. Pregunta sin título`
}

function getHeuristicDomainWeight(title) {
  const normalized = normalizeText(title).toLowerCase()
  if (
    /(color|legibilidad|est[eé]tico|minimalista|visual|apariencia|tipograf|estilo)/i.test(
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
    return 'Comprueba si el sistema informa su estado, progreso y resultados de forma continua para evitar incertidumbre durante la ejecución de tareas.'
  }
  if (/relaci|mundo real|lenguaje/.test(normalized)) {
    return 'Evalúa si la interfaz utiliza lenguaje y conceptos familiares para las personas usuarias, reduciendo interpretaciones ambiguas.'
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
    return 'Mide si la interfaz reduce la carga de memoria manteniendo visible la información relevante y las opciones disponibles.'
  }
  if (/flexibilidad|eficiencia|atajo/.test(normalized)) {
    return 'Examina la eficiencia operativa para perfiles noveles y expertos, incluyendo recorridos optimizados y acciones frecuentes.'
  }
  if (/est[eé]tico|minimalista|visual|legibilidad|color/.test(normalized)) {
    return 'Evalúa la calidad visual y legibilidad para facilitar comprensión rápida, jerarquía clara y reducción de ruido en pantalla.'
  }
  if (/recuperaci[oó]n|diagnosticar|mensajes/.test(normalized)) {
    return 'Analiza la claridad de mensajes de error y la facilidad para recuperar el flujo sin pérdida de contexto.'
  }
  if (/ayuda|documentaci[oó]n/.test(normalized)) {
    return 'Valida la disponibilidad de ayuda útil y accesible para resolver dudas puntuales sin interrumpir el trabajo principal.'
  }
  return 'Evalúa la calidad de uso para detectar fricciones, reducir errores y mejorar eficacia, eficiencia y satisfacción de las personas usuarias.'
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
    console.log(
      `[buildHeuristicEvidence][${getHeuristicShortTitle(heuristic, heuristicIndex)}] ` +
        `totalWarnings=${totalWarnings} totalImages=${totalImages} totalComments=${totalComments}`,
      'questionSummaries:',
      questionSummaries.map((q) => ({
        title: q.title,
        images: q.images,
        comments: q.comments,
        commentDetailsCount: q.commentDetails?.length || 0,
      })),
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
        stripHtml(
          heuristicComments?.[
            heuristic?.heuristicId || `H${heuristicIndex + 1}`
          ] || '',
        ),
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

/**
 * Extrae las URLs de imágenes de allAnswers para una heurística y pregunta específicas.
 */
function getQuestionImageUrls(allAnswers, heuristicIndex, questionIndex) {
  return allAnswers.flatMap((answer) => {
    const q =
      answer?.heuristicQuestions?.[heuristicIndex]?.heuristicQuestions?.[
        questionIndex
      ]
    if (!q) return []
    const imgs = Array.isArray(q?.images)
      ? q.images
      : Array.isArray(q?.heuristicAnswer?.images)
        ? q.heuristicAnswer.images
        : []
    const urls = imgs
      .map((img) => img?.url || img?.imageUrl || img)
      .filter(Boolean)
    const legacyUrl =
      q?.answerImageUrl || q?.heuristicAnswer?.answerImageUrl || ''
    if (legacyUrl && !urls.includes(legacyUrl)) {
      urls.push(legacyUrl)
    }
    return urls
  })
}

/**
 * Extrae todas las URLs de imágenes de allAnswers para una heurística.
 */
function getAllImagesForHeuristic(allAnswers, heuristicIndex, testStructure) {
  const heuristic = testStructure?.[heuristicIndex]
  if (!heuristic) return []
  const questions = heuristic?.questions || heuristic?.heuristicQuestions || []
  const urls = []
  questions.forEach((_, qIdx) => {
    const imgUrls = getQuestionImageUrls(allAnswers, heuristicIndex, qIdx)
    urls.push(...imgUrls)
  })
  return urls
}

/**
 * Extrae el path de Storage desde una URL de descarga de Firebase.
 */
function getStoragePathFromDownloadUrl(downloadUrl) {
  const match = downloadUrl.match(/\/o\/([^?]+)/)
  if (!match) return null
  return decodeURIComponent(match[1])
}

/**
 * Convierte un Blob a base64 (data URL).
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Carga una imagen desde una URL y la convierte a base64 para jsPDF.
 * Primero intenta fetch() directo; si falla por CORS, usa Firebase Storage SDK.
 * Retorna null si falla.
 */
async function loadImageAsBase64(url) {
  console.log('[loadImageAsBase64] Attempting to load:', url)

  // 1) Try direct fetch (works when CORS is configured)
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (response.ok) {
      const blob = await response.blob()
      const base64 = await blobToBase64(blob)
      console.log('[loadImageAsBase64] fetch OK, image loaded')
      return base64
    }
    console.warn('[loadImageAsBase64] fetch returned !ok:', response.status)
  } catch (err) {
    console.warn('[loadImageAsBase64] fetch CORS error:', err.message)
  }

  // 2) Fallback: Firebase Storage SDK (bypasses CORS)
  try {
    const storagePath = getStoragePathFromDownloadUrl(url)
    if (!storagePath) {
      console.warn('[loadImageAsBase64] Could not parse storage path')
      return null
    }
    console.log('[loadImageAsBase64] Trying Firebase SDK for:', storagePath)
    const storage = getStorage()
    const storageRef = ref(storage, storagePath)
    const blob = await getBlob(storageRef)
    const base64 = await blobToBase64(blob)
    console.log('[loadImageAsBase64] Firebase SDK OK, image loaded')
    return base64
  } catch (err) {
    console.warn('[loadImageAsBase64] Firebase SDK fallback failed:', err.message)
    return null
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
  const showQuickSummary = options?.showQuickSummary === true
  const useWarningTerm = showQuickSummary
  const cleanTestDescription = stripHtml(testDescription)
  const cleanStudyConclusion = stripHtml(studyConclusion)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DEBUG: finalResultData
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('[generateHeuristicPdf] finalResultData:', finalResultData)
  console.log(
    '[generateHeuristicPdf] finalResultData keys:',
    finalResultData ? Object.keys(finalResultData) : 'null',
  )
  console.log('[generateHeuristicPdf] finalResultData.sd:', finalResultData?.sd)
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
  const averageTime = formatTimeSpentFromMs(finalResultData?.averageTimeMs || 0)
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
    ensureSpace(40)
    y += 8
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
    y += size === 18 ? 28 : 22
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
      const words = line.split(' ').filter(Boolean)
      if (words.length <= 1) {
        doc.text(line, x, y, { align: 'left' })
      } else {
        const wordsWidth = words.reduce((sum, w) => sum + getTextWidth(w), 0)
        const availableSpace = width - wordsWidth
        const spaceWidth = availableSpace / (words.length - 1)
        // Skip justification if gaps would be too wide; otherwise keep the same visual style.
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
  doc.text('INFORME DE EVALUACIÓN', PAGE_W / 2, y, { align: 'center' })
  y += 22
  doc.text('HEURÍSTICA', PAGE_W / 2, y, { align: 'center' })
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
    'Metodología: 15 Heurísticas de Usabilidad - Nielsen + ISO 9241-110',
    PAGE_W / 2,
    y,
    { align: 'center' },
  )

  if (showQuickSummary) {
    const coverMetricsY = y + 22
    const coverMetricsH = 80
    doc.setDrawColor(...COLORS.border)
    doc.setFillColor(250, 252, 255)
    doc.roundedRect(M, coverMetricsY, CONTENT_W, coverMetricsH, 8, 8, 'FD')
    doc.setFont(FONT, 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.accent)
    doc.text('Resumen rápido', M + 14, coverMetricsY + 18)
    doc.setFont(FONT, 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.text)
    const evaluatorCount =
      evaluatorSummaryItems.length || evaluatorTimeItems.length || 0
    const coverMetricLines = [
      `Cumplimiento global: ${globalPct}`,
      `Severidad: ${globalSeverity}`,
      `Evaluadores: ${evaluatorCount}`,
    ]
    if (testUrl) {
      coverMetricLines.push(`URL evaluada: ${testUrl}`)
    }
    coverMetricLines.forEach((line, index) => {
      const rowY = coverMetricsY + 36 + index * 12
      doc.text(line, M + 14, rowY)
    })
  }

  y = PAGE_H - M
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.sub)
  doc.text('RUXAILAB - Informe generado automáticamente', PAGE_W / 2, y, {
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
  doc.text('ÍNDICE', M, y)
  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.5)
  doc.line(M, y + 4, M + 60, y + 4)
  y += 30

  // ─── 1. INTRODUCCION ─────────────────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('1. Introducción')

  writeParagraph(
    `Este informe recoge los resultados de la evaluación heurística realizada al sistema "${testTitle || 'Sistema evaluado'}".`,
  )
  if (cleanTestDescription) {
    writeParagraph(cleanTestDescription)
  }
  const evaluatorCount =
    evaluatorTimeItems.length || evaluatorSummaryItems.length || 0
  writeParagraph(
    `La evaluación ha sido completada por ${evaluatorCount} ${pluralize(evaluatorCount, 'evaluador', 'evaluadores')} y se apoya en el promedio de respuestas, los avisos de warning, los comentarios y las evidencias visuales recogidas durante el test.`,
  )
  writeParagraph(
    `El resultado global de la evaluación se interpreta con un margen de mejora ${globalSeverity}, con un promedio de cumplimiento entre evaluadores del ${Number(getNumber(evaluatorPercentages?.globalAverage || 0)).toFixed(2)}%. Este dato se calcula sumando los porcentajes individuales de cumplimiento y dividiendo entre el número total de evaluadores.`,
  )
  // SD global — shown here, "escenarios de warning maximo/minimo" removed
  console.log(
    '[generateHeuristicPdf] About to write SD paragraph with values:',
    { globalSd, globalMax, globalMin },
  )
  writeParagraph(
    `La desviación estándar global de las puntuaciones es ${globalSd}, lo que refleja el grado de consenso entre los evaluadores: valores bajos indican alta coincidencia y valores altos señalan mayor divergencia en la percepción de la usabilidad del sistema. El valor máximo (${globalMax}) corresponde al mayor porcentaje de cumplimiento obtenido por un evaluador, mientras que el valor mínimo (${globalMin}) corresponde al menor porcentaje de cumplimiento obtenido por otro evaluador.`,
  )
  if (totalWarnings > 0 || totalComments > 0 || totalImages > 0) {
    const metadataBits = []
    if (totalWarnings > 0) {
      const w = totalWarnings
      if (useWarningTerm) {
        metadataBits.push(
          `${w} ${pluralize(w, 'respuesta con warning', 'respuestas con warning')}`,
        )
      } else {
        metadataBits.push(
          `${w} ${pluralize(w, 'pregunta que requiere un análisis más profundo', 'preguntas que requieren un análisis más profundo')}`,
        )
      }
    }
    if (totalComments > 0) {
      const c = totalComments
      metadataBits.push(`${c} ${pluralize(c, 'comentario', 'comentarios')}`)
    }
    if (totalImages > 0) {
      const i = totalImages
      metadataBits.push(`${i} ${pluralize(i, 'imagen', 'imágenes')}`)
    }
    if (useWarningTerm) {
      writeParagraph(
        `La evaluación general incorpora ${metadataBits.join(', y ')}. Los warnings son indicadores de posibles mejoras internas pero que no afectan directamente al porcentaje de cumplimiento. En cambio, los comentarios y las evidencias visuales aportan contexto cualitativo que ayuda a interpretar los resultados cuantitativos y a priorizar las áreas de mejora identificadas.`,
      )
    } else {
      writeParagraph(
        `La evaluación general incorpora ${metadataBits.join(', y ')}. Estas preguntas señalan aspectos que no pueden verificarse únicamente con la navegación superficial de la web, sino que requieren una revisión más profunda del sistema. Los comentarios y las evidencias visuales aportan contexto cualitativo que ayuda a interpretar los resultados cuantitativos y a priorizar las áreas de mejora identificadas.`,
      )
    }
  }

  // ─── 2. RESUMEN EJECUTIVO ─────────────────────────────────────────────────
  startSection('2. Resumen ejecutivo')
  writeParagraph(
    'La tabla siguiente muestra el porcentaje global de cumplimiento obtenido por cada evaluador. El valor se calcula a partir de las respuestas aplicables y permite comparar la percepción general de usabilidad entre participantes.',
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
    y = doc.lastAutoTable.finalY + 20
  }

  // ─── 3. PRIORIDAD DE MEJORA ───────────────────────────────────────────────
  startSection('3. Prioridad de mejora por impacto negativo')
  writeParagraph(
    useWarningTerm
      ? 'La priorización combina el porcentaje de cumplimiento con las señales de riesgo recogidas durante la evaluación, como warnings, comentarios y evidencias visuales.'
      : 'La priorización combina el porcentaje de cumplimiento con las señales de riesgo recogidas durante la evaluación, como las preguntas que requieren un análisis más profundo, los comentarios y las evidencias visuales.',
  )
  writeParagraph(
    'La tabla siguiente presenta el cumplimiento calculado por heurística. Para cada evaluador se suman las puntuaciones de las preguntas aplicables, se multiplican por 100 y se dividen entre el número de preguntas aplicables multiplicado por la puntuación máxima. Después se promedian esos porcentajes entre evaluadores.',
  )

  const summaryRows = evidence.orderedByPercentage.map((item) => [
    item.position,
    item.label,
    `${formatDecimal(item.percentage)}%`,
    item.severity,
  ])

  autoTable(doc, {
    startY: y,
    head: [['#', 'Heurística', '% Cumplimiento', 'Severidad']],
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
  y = doc.lastAutoTable.finalY + 20

  // ─── 4. ANALISIS DETALLADO ────────────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('4. Análisis detallado por heurística')

  for (const item of evidence.orderedByImpact) {
    ensureSpace(110)

    // Title + severity badge (keep percentage here as it's the section identifier)
    writeParagraph(item.label, { bold: true, size: 13, spacing: 2 })
    writeParagraph(
      `Nivel: ${item.severity}  |  Desviación típica: ${formatDecimal(item.sd)}`,
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

    writeParagraph(`Esta heurística evalúa: ${purposeText}`, {
      size: 10,
      spacing: 6,
    })

    // ── Tabla de criterios evaluados ─────────────────────────────────────
    if (item.questionSummaries.length > 0) {
      writeParagraph('Criterios evaluados:', {
        bold: true,
        size: 10,
        spacing: 3,
      })
      writeParagraph(
        'La tabla siguiente presenta cada pregunta y la media de las puntuaciones dadas por los evaluadores, expresada sobre la escala máxima disponible.',
        { size: 11, spacing: 5 },
      )

      const maxQuestionScore = getMaxQuestionScore(allOptions)
      const questionRows = item.questionSummaries.map((q) => {
        const avg = q.average
        const maxVal = maxQuestionScore || 1
        const formattedAvg =
          typeof avg === 'number'
            ? ((avg / maxVal) * 100).toFixed(2).replace('.', ',') + '%'
            : '—'
        return [q.title, formattedAvg]
      })

      ensureSpace(questionRows.length * 14 + 30)
      autoTable(doc, {
        startY: y,
        head: [['Pregunta', 'Media de puntuación']],
        body: questionRows,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: COLORS.accent, textColor: COLORS.white },
        alternateRowStyles: { fillColor: COLORS.zebra },
        margin: { left: M + 6, right: M },
        theme: 'grid',
        columnStyles: {
          0: { overflow: 'linebreak' },
          1: { halign: 'center', cellWidth: 40 },
        },
      })
      y = doc.lastAutoTable.finalY + 20
    }

    // ── Renderizar comentarios de evaluadores ────────────────────────────
    const allCommentDetails = item.questionSummaries.flatMap(
      (q) => q.commentDetails || [],
    )
    console.log(
      `[pdfGenerator] Heuristic #${item.position} commentDetails:`,
      allCommentDetails.length,
      'items',
      allCommentDetails.map((c) => c.evaluatorName + ': ' + c.text.substring(0, 50)),
    )
    if (allCommentDetails.length > 0) {
      writeParagraph('Comentarios de los evaluadores:', {
        bold: true,
        size: 10,
        spacing: 3,
      })
      for (const cd of allCommentDetails) {
        const commentLine = `${cd.evaluatorName}: "${stripHtml(cd.text)}"`
        const wrapped = doc.splitTextToSize(commentLine, CONTENT_W - 12)
        for (const line of wrapped) {
          ensureSpace(12)
          doc.setFont(FONT, 'normal')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.text)
          doc.text(line, M + 6, y)
          y += 11
        }
        y += 2
      }
    }

    // ── Renderizar imágenes de evaluadores ───────────────────────────────
    const heuristicIndex = (item.position || 1) - 1
    const imgUrls = getAllImagesForHeuristic(
      allAnswers,
      heuristicIndex,
      testStructure,
    )
    console.log(
      `[pdfGenerator] Heuristic #${item.position} imgUrls:`,
      imgUrls.length,
      imgUrls.slice(0, 4),
    )
    if (imgUrls.length > 0) {
      writeParagraph(`Evidencias visuales (${imgUrls.length}):`, {
        bold: true,
        size: 10,
        spacing: 3,
      })
      const maxImgs = Math.min(imgUrls.length, 4)
      for (let ii = 0; ii < maxImgs; ii++) {
        try {
          const base64 = await loadImageAsBase64(imgUrls[ii])
          if (base64) {
            ensureSpace(110)
            const imgWidth = Math.min(CONTENT_W - 12, 240)
            const imgHeight = 90
            doc.addImage(base64, 'JPEG', M + 6, y, imgWidth, imgHeight)
            y += imgHeight + 6
          }
        } catch {
          // Si falla la carga, mostrar la URL como texto
          ensureSpace(12)
          doc.setFont(FONT, 'normal')
          doc.setFontSize(8)
          doc.setTextColor(...COLORS.sub)
          doc.text(`Imagen: ${imgUrls[ii]}`, M + 6, y)
          y += 11
        }
      }
    }

    // ── Desviación típica por heurística ─────────────────────────────────
    const sdValue = item.sd
    let sdInterpretation = ''
    if (sdValue < 0.2) {
      sdInterpretation = `La desviación típica de las respuestas en esta heurística es baja (${formatDecimal(sdValue)}), lo que indica que los evaluadores coincidieron ampliamente en sus valoraciones.`
    } else if (sdValue < 0.5) {
      sdInterpretation = `La desviación típica es moderada (${formatDecimal(sdValue)}), lo que refleja cierta divergencia entre evaluadores en algunos criterios, aunque sin llegar a ser contradictoria.`
    } else {
      sdInterpretation = `La desviación típica es alta (${formatDecimal(sdValue)}), lo que señala una percepción muy dispar entre evaluadores. Esto puede indicar que la experiencia varía notablemente según el perfil del usuario o el contexto de uso.`
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
        'El diagnóstico global de esta heurística es desfavorable. La mayoría de los criterios evaluados presentan cumplimiento bajo o nulo, lo que indica que esta área representa una fricción real y consistente para el usuario. Se recomienda priorizar su revisión en el siguiente ciclo de diseño.'
    } else if (strongQuestions.length > item.questionSummaries.length / 2) {
      globalDiagnosis =
        'El diagnóstico global de esta heurística es favorable. La mayoría de criterios evaluados obtienen confirmación positiva por parte de los evaluadores, lo que indica que el sistema resuelve bien esta dimensión de uso.'
    } else {
      globalDiagnosis =
        'El diagnóstico global de esta heurística es mixto. Conviven criterios bien resueltos con otros que presentan margen claro de mejora, lo que sugiere una implementación parcial o inconsistente dentro del flujo.'
    }
    writeParagraph(globalDiagnosis, { size: 10, spacing: 4 })

    // ── Impacto negativo ─────────────────────────────────────────────────
    writeParagraph('Impacto negativo actual:', {
      bold: true,
      size: 10,
      spacing: 2,
    })
    writeParagraph(buildNegativeImpact(item), { size: 10, spacing: 4 })

    // ── Beneficio si mejora ──────────────────────────────────────────────
    writeParagraph('Beneficio esperado si se mejora:', {
      bold: true,
      size: 10,
      spacing: 2,
    })
    writeParagraph(buildPositiveImpact(item), { size: 10, spacing: 4 })

    // ── Metadata (warnings / images / comments) ──────────────────────────
    if (item.totalWarnings > 0) {
      const w = item.totalWarnings
      if (useWarningTerm) {
        writeParagraph(
          `Durante la evaluación, ${w} ${pluralize(w, 'respuesta fue marcada', 'respuestas fueron marcadas')} con warning, lo que refuerza la necesidad de revisión específica en los criterios señalados.`,
          { size: 10, color: COLORS.sub, spacing: 4 },
        )
      } else {
        writeParagraph(
          `Durante la evaluación, ${w} ${pluralize(w, 'pregunta requiere un análisis más profundo al no poder verificarse solo con la navegación superficial', 'preguntas requieren un análisis más profundo al no poder verificarse solo con la navegación superficial')}, lo que refuerza la necesidad de revisión específica en los criterios señalados.`,
          { size: 10, color: COLORS.sub, spacing: 4 },
        )
      }
    }
    if (item.totalImages > 0) {
      const img = item.totalImages
      writeParagraph(
        `Se ${pluralize(img, 'adjuntó', 'adjuntaron')} ${img} ${pluralize(img, 'evidencia visual', 'evidencias visuales')} que documentan los hallazgos de esta heurística.`,
        { size: 10, spacing: 4 },
      )
    }
    if (normalizeText(item.comments)) {
      writeParagraph(
        `Comentarios de los evaluadores: ${stripHtml(item.comments)}`,
        {
          size: 10,
          color: COLORS.sub,
          spacing: 4,
        },
      )
    }

    y += 14
  }

  // ─── 5. COMPARATIVA POR EVALUADOR ────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('5. Comparativa de puntuaciones por evaluador')
  writeParagraph(
    'La matriz siguiente muestra los valores medios de respuesta por heurística y evaluador. Los colores facilitan detectar respuestas bajas, medias y altas de forma visual.',
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
    y = doc.lastAutoTable.finalY + 20
  }

  writeParagraph(
    'La tabla siguiente muestra tiempos por heurística, total y promedio por evaluador.',
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
    y = doc.lastAutoTable.finalY + 20
  }

  writeParagraph(`Tiempo medio de ejecución global: ${averageTime}.`)

  // ─── 6. CONCLUSION ────────────────────────────────────────────────────────
  startSection('6. Conclusión')
  if (cleanStudyConclusion) {
    writeParagraph(cleanStudyConclusion)
  }
  const warningText = useWarningTerm
    ? pluralize(totalWarnings, 'warning', 'warnings')
    : pluralize(
        totalWarnings,
        'pregunta que requiere un análisis más profundo',
        'preguntas que requieren un análisis más profundo',
      )
  const commentText = pluralize(totalComments, 'comentario', 'comentarios')
  const imageText = pluralize(totalImages, 'imagen', 'imágenes')
  writeParagraph(
    `En conjunto, el informe muestra un cumplimiento global de ${globalPct}, con ${totalWarnings} ${warningText}, ${totalComments} ${commentText} y ${totalImages} ${imageText} registradas como evidencias.`,
  )
  writeParagraph(
    'Las heurísticas con peor posición en el ranking de impacto son las que combinan bajo cumplimiento y señales de riesgo operativo, por lo que deben priorizarse en la hoja de ruta de mejora.',
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

  const fileName = `informe_heurística_${
    testTitle ? testTitle.replace(/\s+/g, '_').toLowerCase() : 'evaluación'
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

export {
  loadLogo,
  addFooter,
  getSeverityFromPercentage,
  normalizeText,
  pluralize,
  stripHtml,
  extractCommentTexts,
  getNumber,
  getHeuristicLabel,
  getHeuristicShortTitle,
  getEvaluatorLabel,
  getQuestionLabel,
  getHeuristicDomainWeight,
  getHeuristicPurposeText,
  getQuestionQualitativeLabel,
  buildNegativeImpact,
  buildPositiveImpact,
  formatDecimal,
  getHeuristicsCellColor,
  getContrastingTextColor,
  parseMmSsToMs,
  getTimeColor,
  getMaxQuestionScore,
  calculateHeuristicCompliance,
  calcStandardDeviation,
  buildHeuristicEvidence,
  FONT,
  M,
  PAGE_W,
  PAGE_H,
  CONTENT_W,
  LH,
  COLORS,
  SEVERITY_COLORS,
  getQuestionImageUrls,
  getAllImagesForHeuristic,
  loadImageAsBase64,
}
