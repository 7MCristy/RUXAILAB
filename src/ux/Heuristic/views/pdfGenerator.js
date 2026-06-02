import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatTimeSpentFromMs } from '@/ux/Heuristic/utils/statistics'

const FONT = 'helvetica'
const M = 52
const PAGE_W = 595.28
const PAGE_H = 841.89
const CONTENT_W = PAGE_W - M * 2
const LH = 14
const COLORS = {
  text: [51, 51, 51],
  sub: [90, 106, 122],
  accent: [27, 58, 92],
  tableHead: [27, 58, 92],
  zebra: [240, 244, 248],
  border: [208, 217, 228],
  white: [255, 255, 255],
  green: [46, 125, 94],
  yellow: [196, 160, 60],
  red: [183, 28, 28],
}
const SEVERITY_COLORS = {
  Leve: [46, 125, 94],
  Moderado: [196, 160, 60],
  Grave: [219, 136, 40],
  Crítico: [183, 28, 28],
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

function writeJustifiedLines(doc, lines, x, y, width, lineHeight) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isLast = i === lines.length - 1

    if (isLast || line.split(' ').length <= 1) {
      doc.text(line, x, y)
    } else {
      const lineWidth =
        (doc.getStringUnitWidth(line) * doc.getFontSize()) /
        doc.internal.scaleFactor
      const spaceCount = (line.match(/ /g) || []).length
      if (spaceCount === 0) {
        doc.text(line, x, y)
      } else {
        const extra = (width - lineWidth) / spaceCount
        let cx = x
        const parts = line.split(/( )/)
        for (let j = 0; j < parts.length; j++) {
          if (parts[j] === ' ') {
            cx +=
              extra +
              (doc.getStringUnitWidth(' ') * doc.getFontSize()) /
                doc.internal.scaleFactor
          } else {
            doc.text(parts[j], cx, y)
            cx +=
              (doc.getStringUnitWidth(parts[j]) * doc.getFontSize()) /
              doc.internal.scaleFactor
          }
        }
      }
    }
    y += lineHeight
  }
  return y
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

function checkPageSpace(doc, y, needed) {
  if (y + needed > PAGE_H - M) {
    doc.addPage()
    return M
  }
  return y
}

function getSeverityFromPercentage(value) {
  const n = parseFloat(value)
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

function getNumber(value, fallback = 0) {
  const numericValue = Number.parseFloat(String(value ?? '').replace(',', '.'))
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

function getHeuristicsCellColor(value, max, min) {
  const numericValue = Number(value)
  const numericMax = Number(max)
  const numericMin = Number(min)

  if (!Number.isFinite(numericValue)) {
    return { fill: [238, 238, 238], text: [119, 119, 119] }
  }
  if (!Number.isFinite(numericMax) || !Number.isFinite(numericMin)) {
    return { fill: [238, 238, 238], text: [119, 119, 119] }
  }
  if (numericMax === numericMin) {
    return numericValue > 0
      ? { fill: [229, 243, 232], text: [37, 168, 58] }
      : { fill: [238, 238, 238], text: [119, 119, 119] }
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

function buildHeuristicEvidence({
  allAnswers = [],
  testStructure = [],
  heuristicsStatistics = [],
  heuristicComments = {},
}) {
  const heuristics = testStructure.map((heuristic, heuristicIndex) => {
    const evaluatorHeuristics = allAnswers
      .map((answer) => answer?.heuristicQuestions?.[heuristicIndex])
      .filter(Boolean)
    const questionDefinitions = Array.isArray(heuristic?.heuristicQuestions)
      ? heuristic.heuristicQuestions
      : []

    const questionSummaries = questionDefinitions.map(
      (question, questionIndex) => {
        const questionAnswers = evaluatorHeuristics
          .map((answer) => answer?.heuristicQuestions?.[questionIndex])
          .filter(Boolean)

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
        const comments = questionAnswers.reduce((total, answer) => {
          const legacyComment = normalizeText(answer?.heuristicComment)
          const arrayComments = Array.isArray(answer?.comments)
            ? answer.comments.filter(
                (comment) => normalizeText(comment?.text || comment).length > 0,
              ).length
            : 0
          return total + arrayComments + (legacyComment ? 1 : 0)
        }, 0)
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

    const percentage = getNumber(heuristicStat.percentage)
    const averagePoints = getNumber(heuristicStat.average)
    const maxPoints = getNumber(heuristicStat.max)
    const minPoints = getNumber(heuristicStat.min)
    const sd = getNumber(heuristicStat.sd)
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
    const responseValues = questionSummaries.flatMap((item) => item.values)
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
  const {
    testTitle,
    testDescription,
    testUrl,
    evaluatorPercentages,
    heuristicsEvaluator,
    heuristicsStatistics,
    finalResultData,
    heuristicComments,
    studyConclusion,
    testStructure,
    allAnswers,
    statisticsTable,
    statisticsByEvaluatorAnswer,
    timeByHeuristics,
  } = reportData
  const mode = options?.mode || 'download'

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const logo = await loadLogo('/brand/logo_full.png', 30)
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
    heuristicsStatistics: heuristicStatsItems,
    heuristicComments: heuristicComments || {},
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
    ensureSpace(44)
    tocEntries.push({ title, page: pageNum })
    // Write section title justified within content width
    doc.setFont(FONT, 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...COLORS.accent)
    const titleLines = doc.splitTextToSize(normalizeText(title), CONTENT_W)
    ensureSpace(titleLines.length * (size + 4) + 8)
    y = writeJustifiedLines(doc, titleLines, M, y, CONTENT_W, size + 4)
    doc.setDrawColor(...COLORS.accent)
    doc.setLineWidth(0.4)
    const lineLen = Math.min(size * 3.5, CONTENT_W * 0.4)
    doc.line(M, y, M + lineLen, y)
    y += size === 18 ? 22 : 18
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.text)
  }

  const writeParagraph = (text, options = {}) => {
    const lh = options.lineHeight || LH
    doc.setFont(FONT, options.bold ? 'bold' : 'normal')
    doc.setFontSize(options.size || 11)
    doc.setTextColor(...(options.color || COLORS.text))
    const lines = doc.splitTextToSize(
      normalizeText(text),
      options.width || CONTENT_W,
    )

    const shouldJustify = options.justify !== false

    if (shouldJustify) {
      // Justificar línea a línea, haciendo saltos de página cuando sea necesario
      for (let i = 0; i < lines.length; i++) {
        ensureSpace(lh + 4) // garantiza espacio para esta línea concreta
        const isLastLine = i === lines.length - 1
        if (isLastLine) {
          // Última línea: alinear a la izquierda (comportamiento estándar justified)
          doc.text(lines[i], options.x || M, y, { align: 'left' })
        } else {
          y = writeJustifiedLines(
            doc,
            [lines[i]],
            options.x || M,
            y,
            options.width || CONTENT_W,
            lh,
          )
          continue // writeJustifiedLines ya avanza y
        }
        y += lh
      }
    } else {
      ensureSpace(lines.length * lh + (options.spacing || 4) + 8)
      doc.text(lines, options.x || M, y, { align: 'left' })
      y += lines.length * lh
    }

    y += options.spacing || 6
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.text)
  }

  const writeHeuristicImpactText = (item) => {
    const lowCompliance = item.percentage < 50
    const visualHeuristic =
      item.title.toLowerCase().includes('color') ||
      item.title.toLowerCase().includes('legibilidad') ||
      item.title.toLowerCase().includes('estético')
    const functionalBoost = item.impactScore >= 60 || item.totalWarnings > 0
    const currentImpact = visualHeuristic
      ? 'El incumplimiento afecta sobre todo a la claridad visual, la legibilidad y la percepcion general de la interfaz; el impacto funcional suele ser mas limitado que en otras heuristicas.'
      : lowCompliance
        ? 'El incumplimiento introduce friccion directa en la ejecucion de tareas, eleva la carga cognitiva y aumenta la probabilidad de errores o de reintentos.'
        : 'El riesgo actual es moderado y se concentra en puntos concretos del flujo mas que en un bloqueo general del uso.'
    const improvementImpact = visualHeuristic
      ? 'Su resolucion mejoraria la accesibilidad y la comprension visual, con una ganancia gradual y acumulativa en la experiencia.'
      : functionalBoost
        ? 'Resolverla tendria un impacto alto: reduciria errores, simplificaria decisiones y mejoraria la eficiencia de uso desde el flujo principal.'
        : 'La mejora aliviaria puntos de friccion concretos y ayudaria a estabilizar la experiencia general sin alterar por completo el flujo.'

    return { currentImpact, improvementImpact }
  }

  // Portada
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
  doc.text(testTitle || 'Sistema evaluado', PAGE_W / 2, y, { align: 'center' })
  y += 28

  if (testUrl) {
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.sub)
    doc.text(testUrl, PAGE_W / 2, y, { align: 'center' })
    y += 24
  }

  doc.setFontSize(10)
  doc.setTextColor(...COLORS.sub)
  const evaluatorLabels = evaluatorTimeItems
    .map((item, index) => getEvaluatorLabel(item, index))
    .filter(Boolean)
    .join(' · ')
  if (evaluatorLabels) {
    doc.text(`Evaluadores: ${evaluatorLabels}`, PAGE_W / 2, y, {
      align: 'center',
    })
    y += 20
  }
  doc.text(
    'Metodologia: 15 Heuristicas de Usabilidad - Nielsen + ISO 9241-110',
    PAGE_W / 2,
    y,
    { align: 'center' },
  )

  // pie de portada
  y = PAGE_H - M
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.sub)
  doc.text('RUXAILAB - Informe generado automaticamente', PAGE_W / 2, y, {
    align: 'center',
  })

  // Indice
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

  // Introduccion
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
    `El porcentaje medio global de usabilidad es ${globalPct} y su severidad global se interpreta como ${globalSeverity}.`,
  )
  writeParagraph(
    `La desviacion estandar global es ${normalizeText(finalResultData?.sd || '0.00%')}, con escenarios de warning en maximo ${normalizeText(finalResultData?.avrgmaxWarning || '0.00%')} y minimo ${normalizeText(finalResultData?.avrgminWarning || '0.00%')}.`,
  )
  writeParagraph(
    `El promedio de cumplimiento entre evaluadores es ${Number(getNumber(evaluatorPercentages?.globalAverage || 0)).toFixed(2)}%. Este dato se calcula sumando los porcentajes individuales de cumplimiento y dividiendo entre el numero total de evaluadores.`,
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

  // Resumen ejecutivo
  startSection('2. Resumen ejecutivo')
  writeParagraph(
    'La tabla siguiente resume las respuestas por heuristica con los valores reales del analisis y su severidad asociada. Se ordena de menor a mayor porcentaje de cumplimiento para mostrar primero las areas con mayor margen de mejora.',
  )

  const summaryRows = evidence.orderedByPercentage.map((item) => [
    item.position,
    item.label,
    `${item.percentage.toFixed(2)}%`,
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
        data.cell.styles.textColor =
          severity === 'Crítico' ? COLORS.white : COLORS.text
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.column.index === 3) {
        const color = SEVERITY_COLORS[data.cell.raw] || COLORS.zebra
        data.cell.styles.fillColor = color
        data.cell.styles.textColor =
          data.cell.raw === 'Crítico' ? COLORS.white : COLORS.text
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })
  y = doc.lastAutoTable.finalY + 18

  // Prioridad de mejora
  startSection('3. Prioridad de mejora por impacto negativo')
  writeParagraph(
    'La priorizacion no se basa solo en el porcentaje mas bajo: tambien se ponderan las respuestas warning, la presencia de comentarios y el peso funcional de la heuristica. En heuristicas mas visuales o de estilo, el impacto esperado de una mejora suele ser mas incremental que estructural.',
  )

  evidence.orderedByImpact.forEach((item, index) => {
    const { currentImpact, improvementImpact } = writeHeuristicImpactText(item)
    ensureSpace(90)
    doc.setFont(FONT, 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...COLORS.accent)
    doc.text(`${index + 1}. ${item.label}`, M, y)
    const sevColor = SEVERITY_COLORS[item.severity] || COLORS.sub
    doc.setTextColor(...sevColor)
    doc.setFont(FONT, 'normal')
    doc.setFontSize(9)
    const labelW =
      (doc.getStringUnitWidth(`${index + 1}. ${item.label}`) * 12) /
      doc.internal.scaleFactor
    doc.text(
      `[${item.percentage.toFixed(2)}% - ${item.severity}]`,
      M + labelW + 8,
      y,
    )
    y += 18

    doc.setFont(FONT, 'normal')
    doc.setFontSize(10)
    writeParagraph(`Impacto en el usuario: ${currentImpact}`, {
      size: 10,
      lineHeight: LH,
      spacing: 2,
      width: CONTENT_W - 8,
      x: M + 8,
    })
    writeParagraph(`Recomendaciones de mejora: ${improvementImpact}`, {
      size: 10,
      lineHeight: LH,
      spacing: 2,
      width: CONTENT_W - 8,
      x: M + 8,
    })
    y += 6
  })

  // Analisis detallado
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('4. Analisis detallado por heuristica')

  evidence.orderedByImpact.forEach((item) => {
    ensureSpace(120)
    doc.setFont(FONT, 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...COLORS.text)
    doc.text(
      `${item.label} [${item.percentage.toFixed(2)}% - ${item.severity}]`,
      M,
      y,
    )
    y += 16

    const impactText = writeHeuristicImpactText(item)
    const heuristicTitle = getHeuristicShortTitle(
      { heuristicTitle: item.title },
      0,
    )
    const purposeText = getHeuristicPurposeText(heuristicTitle)
    const questionsSummary = item.questionSummaries.length
      ? item.questionSummaries.map((question) => question.title).join('; ')
      : 'No se registraron preguntas en esta heuristica.'
    writeParagraph(
      `Esta heuristica (${heuristicTitle}) se utiliza para evaluar aspectos concretos de la experiencia de uso del sistema. ${purposeText} En esta evaluacion se analizaron las siguientes preguntas: ${questionsSummary}.`,
    )

    const responseDescription =
      item.responseAverage >= 4
        ? 'Las respuestas se concentran en valores altos, lo que indica una base de cumplimiento favorable.'
        : item.responseAverage >= 2.5
          ? 'Las respuestas muestran dispersion intermedia y evidencian margen de ajuste en varios puntos del flujo.'
          : 'Las respuestas se situan en valores bajos, lo que sugiere friccion consistente y necesidad de revision prioritaria.'
    const warningDescription =
      item.totalWarnings > 0
        ? `Se han detectado ${item.totalWarnings} respuesta(s) con warning, lo que refuerza la prioridad de correccion en esta heuristica.`
        : 'No se han detectado respuestas con warning en esta heuristica.'

    writeParagraph(`Descripcion general de respuestas: ${responseDescription}`)
    writeParagraph(warningDescription)

    if (item.totalComments > 0 || normalizeText(item.comments)) {
      const commentSummary = normalizeText(item.comments)
        ? item.comments
        : `Se han recogido ${item.totalComments} comentario(s) asociados a esta heuristica.`
      writeParagraph(`Comentarios de los evaluadores: ${commentSummary}`)
    }

    if (item.totalImages > 0) {
      writeParagraph(
        `Imagenes: se han adjuntado ${item.totalImages} evidencia(s) visual(es) en esta heuristica.`,
      )
    }

    writeParagraph(`Impacto en el usuario: ${impactText.currentImpact}`)
    writeParagraph(`Recomendaciones de mejora: ${impactText.improvementImpact}`)
    y += 8
  })

  // Comparativa por evaluador
  doc.addPage()
  pageNum += 1
  y = M
  addPageHeader()
  startSection('5. Comparativa de puntuaciones por evaluador')
  writeParagraph(
    'La primera tabla corresponde a respuestas por evaluador (como en HeuristicsTestAnswer) y mantiene la lectura por colores de severidad de celdas. La segunda tabla muestra tiempos por heuristica, total y promedio por evaluador.',
  )

  const matrixHeaders = Array.isArray(heuristicsEvaluator?.header)
    ? heuristicsEvaluator.header.map(
        (header) => header.title || header.text || header.value || '',
      )
    : []
  const matrixRows = heuristicMatrixItems.map((item) => ({
    heuristic: item.heuristic || '—',
    max: Number(item.max),
    min: Number(item.min),
    values: matrixHeaders.map((_, index) => {
      if (index === 0) return item.heuristic || '—'
      const key = heuristicsEvaluator.header?.[index]?.value
      return item?.[key] != null ? String(item[key]) : '—'
    }),
  }))
  const matrixBody = matrixRows.map((row) => row.values)

  if (matrixHeaders.length > 1) {
    ensureSpace(40)
    autoTable(doc, {
      startY: y,
      head: [matrixHeaders],
      body: matrixBody,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white },
      alternateRowStyles: { fillColor: COLORS.zebra },
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

  const timeByHeuristicsHeader = Array.isArray(timeByHeuristics?.header)
    ? timeByHeuristics.header
    : []
  const timeByHeuristicsItems = Array.isArray(timeByHeuristics?.items)
    ? timeByHeuristics.items
    : []

  const filteredTimeHeader = timeByHeuristicsHeader.filter(
    (header) => (header?.value || '') !== 'timeSd',
  )
  const timeHeaders = filteredTimeHeader.map(
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

  if (timeHeaders.length > 1 && timeRows.length) {
    ensureSpace(40)
    autoTable(doc, {
      startY: y,
      head: [timeHeaders],
      body: timeRows,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white },
      alternateRowStyles: { fillColor: COLORS.zebra },
      margin: { left: M, right: M },
      theme: 'grid',
      didParseCell(data) {
        if (data.section !== 'body') return
        if (data.column.index === 0) return

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

  // Conclusion
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

  // Completar indice con paginas reales
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

  const fileName = `informe_heuristica_${testTitle ? testTitle.replace(/\s+/g, '_').toLowerCase() : 'evaluacion'}.pdf`

  if (mode === 'download') {
    doc.save(fileName)
    return { fileName }
  }

  if (mode === 'preview') {
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    return { fileName, blob, url }
  }

  return { fileName, blob: doc.output('blob') }
}
