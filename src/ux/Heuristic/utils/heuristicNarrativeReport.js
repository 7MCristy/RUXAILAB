const EMPTY_VALUE = 'No disponible'

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function formatNumber(value, decimals = 2) {
  return toFiniteNumber(value).toFixed(decimals)
}

function formatPercentage(value) {
  return `${formatNumber(value)}%`
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(value) {
  if (!value) return EMPTY_VALUE

  const date =
    typeof value === 'number' && value < 10000000000
      ? new Date(value * 1000)
      : new Date(value)

  if (Number.isNaN(date.getTime())) return String(value)

  return date.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function normalizeCell(value) {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE
  return String(value).replace(/\s+/g, ' ').trim()
}

function textTable(headers, rows) {
  const safeRows = rows.length ? rows : [headers.map(() => EMPTY_VALUE)]
  const widths = headers.map((header, index) =>
    Math.max(
      normalizeCell(header).length,
      ...safeRows.map((row) => normalizeCell(row[index]).length),
    ),
  )
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`
  const rowLine = (row) =>
    `| ${row
      .map((cell, index) => normalizeCell(cell).padEnd(widths[index], ' '))
      .join(' | ')} |`

  return [
    border,
    rowLine(headers),
    border,
    ...safeRows.map(rowLine),
    border,
  ].join('\n')
}

function sectionTitle(number, title) {
  return `${number}. ${title.toUpperCase()}`
}

function getAnswers(testAnswerDocument) {
  if (!testAnswerDocument) return []
  if (testAnswerDocument.heuristicAnswers) {
    return Object.values(testAnswerDocument.heuristicAnswers)
  }
  if (testAnswerDocument.taskAnswers) {
    return Object.values(testAnswerDocument.taskAnswers)
  }
  return []
}

function getOptionBounds(testOptions = []) {
  const values = Array.isArray(testOptions)
    ? testOptions
        .map((option) => toFiniteNumber(option?.value, NaN))
        .filter(Number.isFinite)
    : []

  if (!values.length) return { min: 0, max: 1, midpoint: 0.5 }

  const min = Math.min(...values)
  const max = Math.max(...values)

  return {
    min,
    max,
    midpoint: min + (max - min) / 2,
  }
}

function getHeuristicFromTest(test, index) {
  return Array.isArray(test?.testStructure) ? test.testStructure[index] : null
}

function getHeuristicTitle(test, index, fallback) {
  const heuristic = getHeuristicFromTest(test, index)
  return (
    heuristic?.heuristicTitle ||
    heuristic?.title ||
    heuristic?.name ||
    fallback ||
    `H${index + 1}`
  )
}

function getQuestionText(question, index) {
  return (
    question?.title ||
    question?.text ||
    question?.question ||
    question?.description ||
    `Pregunta ${index + 1}`
  )
}

function getHeuristicQuestions({ test, answers, heuristicIndex }) {
  const testHeuristic = getHeuristicFromTest(test, heuristicIndex)
  const testQuestions = Array.isArray(testHeuristic?.heuristicQuestions)
    ? testHeuristic.heuristicQuestions
    : Array.isArray(testHeuristic?.questions)
      ? testHeuristic.questions
      : Array.isArray(testHeuristic?.items)
        ? testHeuristic.items
        : Array.isArray(testHeuristic?.heuristicQuestionsList)
          ? testHeuristic.heuristicQuestionsList
          : []

  if (testQuestions.length) {
    return testQuestions.map((question, index) => ({
      id: question?.id ?? index,
      text: getQuestionText(question, index),
    }))
  }

  const answerHeuristic = answers.find((answer) => {
    const candidate = answer?.heuristicQuestions?.[heuristicIndex]
    return (
      Array.isArray(candidate?.heuristicQuestions) ||
      Array.isArray(candidate?.questions) ||
      Array.isArray(candidate?.items)
    )
  })?.heuristicQuestions?.[heuristicIndex]

  const answerCandidate = answerHeuristic || {}
  const answerQuestions = Array.isArray(answerCandidate.heuristicQuestions)
    ? answerCandidate.heuristicQuestions
    : Array.isArray(answerCandidate.questions)
      ? answerCandidate.questions
      : Array.isArray(answerCandidate.items)
        ? answerCandidate.items
        : []

  return answerQuestions.map((question, index) => ({
    id: question?.id ?? index,
    text: getQuestionText(question, index),
  }))
}

function getTestDescription(test) {
  const description = stripHtml(test?.testDescription || '')
  if (description) return description
  return 'Este informe se centra en analizar el sistema evaluado para identificar los puntos a fortificar en el sistema analizado.'
}

function getAnswerValue(question) {
  const answer = question?.heuristicAnswer
  if (answer && typeof answer === 'object') return toFiniteNumber(answer.value)
  return toFiniteNumber(answer)
}

function standardDeviation(values = []) {
  if (!Array.isArray(values) || !values.length) return 0

  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length

  return Math.sqrt(variance)
}

function getHeuristicEvaluatorScores(answers, heuristicIndex) {
  return (Array.isArray(answers) ? answers : [])
    .map((answer) => {
      const heuristic = answer?.heuristicQuestions?.[heuristicIndex]
      const questions = Array.isArray(heuristic?.heuristicQuestions)
        ? heuristic.heuristicQuestions
        : []

      if (!questions.length) return null

      return questions.reduce(
        (total, question) => total + toFiniteNumber(getAnswerValue(question)),
        0,
      )
    })
    .filter((value) => value !== null)
}

function hasWarning(question) {
  return question?.heuristicAnswer?.warning === true
}

function getCommentText(comment) {
  if (typeof comment === 'string') return comment.trim()
  return String(comment?.text || '').trim()
}

function getQuestionComments(question) {
  const answer = question?.heuristicAnswer || {}
  const comments = []

  if (Array.isArray(question?.comments)) comments.push(...question.comments)
  if (Array.isArray(answer?.comments)) comments.push(...answer.comments)

  const validComments = comments.map(getCommentText).filter(Boolean)
  const legacyComment =
    question?.heuristicComment || answer?.heuristicComment || ''

  if (legacyComment.trim()) validComments.push(legacyComment.trim())

  return [...new Set(validComments)]
}

function getQuestionImages(question) {
  const answer = question?.heuristicAnswer || {}
  const images = []

  if (Array.isArray(question?.images)) images.push(...question.images)
  if (Array.isArray(answer?.images)) images.push(...answer.images)
  if (question?.answerImageUrl) images.push({ url: question.answerImageUrl })
  if (answer?.answerImageUrl) images.push({ url: answer.answerImageUrl })

  return images
    .map((image) => (typeof image === 'string' ? image : image?.url))
    .filter(Boolean)
}

function severityLabel(percentage, warningCount) {
  if (percentage < 40 || warningCount >= 3) return 'Critica'
  if (percentage < 60 || warningCount >= 2) return 'Alta'
  if (percentage < 80 || warningCount >= 1) return 'Media'
  return 'Baja'
}

function severityValue(label) {
  return {
    Critica: 4,
    Alta: 3,
    Media: 2,
    Baja: 1,
  }[label]
}

function isMostlyVisualHeuristic(title) {
  return [
    'estet',
    'aesthetic',
    'visual',
    'design',
    'dise',
    'style',
    'minimalist',
  ].some((keyword) => String(title).toLowerCase().includes(keyword))
}

function colorLabelForPercentage(percentage) {
  if (percentage < 40) return 'ROJO'
  if (percentage < 60) return 'NARANJA'
  if (percentage < 80) return 'AMARILLO'
  return 'VERDE'
}

function colorClassForPercentage(percentage) {
  return colorLabelForPercentage(percentage).toLowerCase()
}

function collectHeuristicEvidence({ answers, heuristicIndex, testOptions }) {
  const { midpoint } = getOptionBounds(testOptions)
  const questionMap = new Map()
  let affectedEvaluators = 0
  let totalEvaluators = 0
  let totalComments = 0
  let totalImages = 0
  let warningCount = 0

  answers.forEach((answer, evaluatorIndex) => {
    const heuristic = answer?.heuristicQuestions?.[heuristicIndex]
    const questions = Array.isArray(heuristic?.heuristicQuestions)
      ? heuristic.heuristicQuestions
      : []

    if (!questions.length) return

    totalEvaluators += 1
    let evaluatorHasIssue = false

    questions.forEach((question, questionIndex) => {
      const value = getAnswerValue(question)
      const comments = getQuestionComments(question)
      const images = getQuestionImages(question)
      const warning = hasWarning(question)
      const isFailed = value <= midpoint || warning

      totalComments += comments.length
      totalImages += images.length
      warningCount += warning ? 1 : 0

      if (!isFailed && comments.length === 0 && images.length === 0) return

      evaluatorHasIssue = evaluatorHasIssue || isFailed
      const key = question?.id ?? questionIndex
      const current = questionMap.get(key) || {
        text: getQuestionText(question, questionIndex),
        detections: 0,
        warningCount: 0,
        evaluatorIds: [],
        comments: [],
        images: [],
      }

      current.detections += isFailed ? 1 : 0
      current.warningCount += warning ? 1 : 0
      current.evaluatorIds.push(`Ev${evaluatorIndex + 1}`)
      current.comments.push(...comments)
      current.images.push(...images)
      questionMap.set(key, current)
    })

    if (evaluatorHasIssue) affectedEvaluators += 1
  })

  return {
    problems: Array.from(questionMap.values())
      .sort((left, right) => {
        const leftScore = left.detections + left.warningCount
        const rightScore = right.detections + right.warningCount
        return rightScore - leftScore
      })
      .slice(0, 6),
    affectedEvaluators,
    totalEvaluators,
    affectedPercentage: totalEvaluators
      ? (affectedEvaluators * 100) / totalEvaluators
      : 0,
    totalComments,
    totalImages,
    warningCount,
  }
}

function countEvaluatorsWithWarnings(answers = []) {
  const set = new Set()
  answers.forEach((answer, evaluatorIndex) => {
    const heuristics = Array.isArray(answer?.heuristicQuestions)
      ? answer.heuristicQuestions
      : []
    heuristics.forEach((heuristic) => {
      const questions = Array.isArray(heuristic?.heuristicQuestions)
        ? heuristic.heuristicQuestions
        : []
      questions.forEach((question) => {
        if (hasWarning(question)) set.add(evaluatorIndex)
      })
    })
  })
  return set.size
}

function calculateImpactScore({ compliance, sd, title, evidence }) {
  const severity = severityValue(
    severityLabel(compliance, evidence.warningCount),
  )
  const missingCompliance = (100 - compliance) / 10
  const warningFactor = Math.min(4, evidence.warningCount)
  const evidenceFactor = Math.min(
    3,
    evidence.totalComments + evidence.totalImages,
  )
  const disagreementFactor = sd > 1 ? 1 : 0
  const visualAdjustment = isMostlyVisualHeuristic(title) ? 0.65 : 1

  return (
    (missingCompliance +
      severity * 2 +
      warningFactor +
      evidenceFactor +
      disagreementFactor) *
    visualAdjustment
  )
}

function buildHeuristicRows({
  test,
  testAnswerDocument,
  statisticsByHeuristics,
  evaluatorCount,
}) {
  const answers = getAnswers(testAnswerDocument)
  const fallbackRows = Array.isArray(statisticsByHeuristics?.items)
    ? statisticsByHeuristics.items
    : []
  const heuristicCount = Math.max(
    Array.isArray(test?.testStructure) ? test.testStructure.length : 0,
    fallbackRows.length,
    answers.reduce(
      (max, answer) =>
        Math.max(
          max,
          Array.isArray(answer?.heuristicQuestions)
            ? answer.heuristicQuestions.length
            : 0,
        ),
      0,
    ),
  )

  return Array.from({ length: heuristicCount }, (_, index) => {
    const fallbackItem = fallbackRows[index] || {}
    const questions = getHeuristicQuestions({
      test,
      answers,
      heuristicIndex: index,
    })
    const questionCount = questions.length
    const { max: optionMax, min: optionMin } = getOptionBounds(
      test?.testOptions,
    )
    const evaluatorScores = getHeuristicEvaluatorScores(answers, index)
    const totalScoresSum = evaluatorScores.reduce(
      (total, value) => total + value,
      0,
    )
    const evaluatorsWithData = evaluatorScores.length
    const average = evaluatorCount ? totalScoresSum / evaluatorCount : 0
    const maxTotal =
      evaluatorCount && questionCount
        ? evaluatorCount * questionCount * optionMax
        : toFiniteNumber(fallbackItem.max)
    const minTotal = questionCount
      ? questionCount * optionMin
      : toFiniteNumber(fallbackItem.min)
    const compliance = maxTotal > 0 ? (average / maxTotal) * 100 : 0
    const sd = standardDeviation(evaluatorScores)
    const title = getHeuristicTitle(test, index, fallbackItem.name)
    const evidence = collectHeuristicEvidence({
      answers,
      heuristicIndex: index,
      testOptions: test?.testOptions,
    })
    const impact = calculateImpactScore({ compliance, sd, title, evidence })
    const severity = severityLabel(compliance, evidence.warningCount)

    return {
      id: fallbackItem.name || `H${index + 1}`,
      index,
      title,
      questions,
      compliance,
      sd,
      // Pts. Medios: media del total de puntos obtenidos por evaluador en la heuristica
      average,
      // Max: puntuacion maxima total posible para todas las preguntas de esta heuristica
      max: maxTotal,
      min: minTotal,
      severity,
      color: colorLabelForPercentage(compliance),
      impact,
      evidence,
      evaluatorCount: evaluatorsWithData || evaluatorCount,
    }
  }).sort((left, right) => left.compliance - right.compliance)
}

function buildEvaluatorRows({ statisticsByEvaluator, answers }) {
  const items = Array.isArray(statisticsByEvaluator)
    ? statisticsByEvaluator
    : []

  return items.map((item, index) => {
    const answer = answers.find((candidate) => candidate?.userDocId === item.id)
    const timeMs = Array.isArray(item.heuristics)
      ? item.heuristics.reduce(
          (total, heuristic) => total + toFiniteNumber(heuristic.timeSpentMs),
          0,
        )
      : 0

    return {
      label: `Evaluador ${index + 1}`,
      id: item.id || answer?.userDocId || `Ev${index + 1}`,
      result: item.result || EMPTY_VALUE,
      comments: toFiniteNumber(item.totalComments),
      images: toFiniteNumber(item.totalImages),
      warnings: Array.isArray(item.heuristics)
        ? item.heuristics.reduce(
            (total, heuristic) =>
              total + toFiniteNumber(heuristic.totalWarnings),
            0,
          )
        : 0,
      timeMs,
    }
  })
}

function formatMinutes(ms) {
  if (!ms) return EMPTY_VALUE
  return `${formatNumber(ms / 60000, 1)} min`
}

function buildHeuristicSummaryTable(rankedHeuristics) {
  return textTable(
    [
      'Orden impacto',
      'Heuristica',
      'Nombre',
      'Cumplimiento medio',
      'Warnings',
      'Severidad',
      'Impacto mejora',
    ],
    rankedHeuristics.map((heuristic, index) => [
      index + 1,
      heuristic.id,
      heuristic.title,
      `${formatPercentage(heuristic.compliance)} (${heuristic.color})`,
      heuristic.evidence.warningCount,
      heuristic.severity,
      formatNumber(heuristic.impact, 1),
    ]),
  )
}

function buildEvaluatorMatrixTable({ test, testAnswerDocument, testOptions }) {
  const answers = getAnswers(testAnswerDocument)
  const evaluatorHeaders = answers.map((_, index) => `Ev${index + 1}`)
  const heuristicCount = Math.max(
    Array.isArray(test?.testStructure) ? test.testStructure.length : 0,
    answers.reduce(
      (max, answer) =>
        Math.max(
          max,
          Array.isArray(answer?.heuristicQuestions)
            ? answer.heuristicQuestions.length
            : 0,
        ),
      0,
    ),
  )

  return textTable(
    ['HEURISTICS', ...evaluatorHeaders],
    Array.from({ length: heuristicCount }, (_, index) => {
      const questions = getHeuristicQuestions({
        test,
        answers,
        heuristicIndex: index,
      })
      const questionCount = questions.length
      const { max: optionMax } = getOptionBounds(testOptions)
      const maxTotal = questionCount ? questionCount * optionMax : 0
      const heuristicLabel = getHeuristicTitle(test, index, `H${index + 1}`)

      return [
        heuristicLabel,
        ...answers.map((answer) => {
          const heuristic = answer?.heuristicQuestions?.[index]
          const qlist = Array.isArray(heuristic?.heuristicQuestions)
            ? heuristic.heuristicQuestions
            : []
          const evaluatorTotal = qlist.length
            ? qlist.reduce(
                (total, question) =>
                  total + toFiniteNumber(getAnswerValue(question)),
                0,
              )
            : 0
          const percentage =
            maxTotal > 0 ? (evaluatorTotal / maxTotal) * 100 : 0
          const colorLabel = colorLabelForPercentage(percentage)

          return `${formatNumber(evaluatorTotal)} [${colorLabel}]`
        }),
      ]
    }),
  )
}

function getEvaluatorValuesForHeuristic(answers, heuristicIndex) {
  return getHeuristicEvaluatorScores(answers, heuristicIndex)
}

function buildQuestionsText(questions) {
  if (!questions.length)
    return 'No hay preguntas registradas para esta heuristica.'

  return questions
    .map((question, index) => `${index + 1}. ${question.text}`)
    .join('\n')
}

function buildResponseDescription(heuristic) {
  const parts = [
    `El cumplimiento medio de esta heuristica es ${formatPercentage(
      heuristic.compliance,
    )}, con una puntuacion media de ${formatNumber(
      heuristic.average,
    )}. La severidad resultante es ${heuristic.severity}.`,
  ]

  if (heuristic.evidence.warningCount > 0) {
    parts.push(
      `Se han detectado ${heuristic.evidence.warningCount} respuesta(s) de warning, por lo que el resultado requiere mas atencion que una puntuacion baja aislada.`,
    )
  }

  if (heuristic.sd > 1) {
    parts.push(
      `La desviacion estandar es ${formatNumber(
        heuristic.sd,
      )}, lo que indica diferencias relevantes entre evaluadores.`,
    )
  }

  return parts.join(' ')
}

function buildCommentsText(heuristic) {
  const comments = heuristic.evidence.problems.flatMap((problem) =>
    problem.comments.map((comment) => ({
      question: problem.text,
      comment,
    })),
  )

  if (!comments.length) return ''

  return [
    'Descripcion neutra de comentarios:',
    ...comments
      .slice(0, 8)
      .map((item) => `- ${item.question}: ${item.comment}`),
  ].join('\n')
}

function buildImagesText(heuristic) {
  if (!heuristic.evidence.totalImages) return ''

  return `Hay ${heuristic.evidence.totalImages} imagen(es) asociada(s) a esta heuristica en las respuestas de evaluacion.`
}

function buildImpactText(heuristic) {
  const visualNote = isMostlyVisualHeuristic(heuristic.title)
    ? ' Aunque esta heuristica parece estar relacionada con estilo o diseno visual, su impacto de mejora se ha moderado porque no siempre bloquea tareas principales.'
    : ''

  return [
    `Impacto negativo actual: al no cumplirse suficientemente esta heuristica, los usuarios pueden encontrar mas dificultad para completar la tarea con seguridad, entender el estado del sistema o corregir errores. El riesgo es mayor cuando hay warnings o cuando varios evaluadores coinciden en la friccion.${visualNote}`,
    `Impacto esperado si se resuelve: mejorar esta heuristica podria elevar el cumplimiento hacia un objetivo operativo del 80%, reducir warnings y hacer que el flujo evaluado sea mas claro, consistente y facil de completar. La mejora debe validarse repitiendo la misma evaluacion y comparando la matriz final de evaluadores.`,
  ].join('\n')
}

function buildHeuristicAnalysis(heuristic, position) {
  const commentsText = buildCommentsText(heuristic)
  const imagesText = buildImagesText(heuristic)

  return [
    `HEURISTICA ${position}. ${heuristic.id} - ${heuristic.title}`,
    `Ordenada por impacto negativo: ${position}`,
    `Cumplimiento medio: ${formatPercentage(heuristic.compliance)}`,
    `Grado de severidad: ${heuristic.severity}`,
    `Warnings detectados: ${heuristic.evidence.warningCount}`,
    '',
    'Que evalua:',
    `Esta heuristica evalua el grado en que el sistema cumple el criterio "${heuristic.title}" dentro de las pantallas o flujos revisados por los evaluadores.`,
    '',
    'Preguntas evaluadas:',
    buildQuestionsText(heuristic.questions),
    '',
    'Descripcion general de las respuestas:',
    buildResponseDescription(heuristic),
    ...(commentsText ? ['', commentsText] : []),
    ...(imagesText ? ['', imagesText] : []),
    '',
    'Impacto actual e impacto de mejora:',
    buildImpactText(heuristic),
  ].join('\n')
}

function buildTimeParagraph(evaluatorRows) {
  const evaluatorsWithTime = evaluatorRows.filter((row) => row.timeMs > 0)
  if (!evaluatorsWithTime.length) {
    return 'No hay tiempo registrado para los evaluadores en las respuestas del test.'
  }

  const averageMs =
    evaluatorsWithTime.reduce((total, row) => total + row.timeMs, 0) /
    evaluatorsWithTime.length
  const details = evaluatorsWithTime
    .map((row) => `${row.label} tardo ${formatMinutes(row.timeMs)}`)
    .join('; ')

  return `${details}. El tiempo medio de evaluacion fue ${formatMinutes(
    averageMs,
  )}. Estos tiempos ayudan a interpretar la profundidad de revision: evaluaciones muy rapidas pueden dejar menos evidencias, mientras que tiempos mas altos suelen permitir comentarios o capturas mas especificas.`
}

function buildConclusion({
  globalAverage,
  rankedHeuristics,
  totalWarnings,
  totalComments,
  totalImages,
}) {
  const mostNegative = rankedHeuristics.slice(0, 3)
  const goodHeuristics = rankedHeuristics.filter(
    (heuristic) => heuristic.compliance >= 80,
  )

  return [
    `La evaluacion concluye con una usabilidad global de ${globalAverage}. Las heuristicas con mayor impacto negativo son ${mostNegative
      .map((heuristic) => `${heuristic.id} ${heuristic.title}`)
      .join(
        ', ',
      )}, porque combinan bajo porcentaje de cumplimiento, warnings o evidencias de friccion.`,
    `El test contiene ${totalWarnings} warning(s), ${totalComments} comentario(s) y ${totalImages} imagen(es) asociados a la evaluacion. Estos elementos refuerzan el analisis cuantitativo cuando existen, ya que muestran donde los evaluadores observaron problemas concretos.`,
    `Como lectura general, las mejoras deberian priorizar primero las heuristicas con bajo cumplimiento y alto impacto operativo. Las heuristicas visuales o de estilo deben considerarse, pero no siempre implican la mayor mejora funcional si no bloquean tareas criticas. Hay ${goodHeuristics.length} heuristica(s) con cumplimiento superior al 80%, que pueden considerarse relativamente estables frente al resto.`,
  ].join('\n\n')
}

function htmlTable({ headers, rows, className = '' }) {
  return `<table class="${className}">
    <thead>
      <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => {
                if (typeof cell === 'object' && cell !== null) {
                  return `<td class="${escapeHtml(cell.className || '')}">${cell.html || escapeHtml(cell.value)}</td>`
                }
                return `<td>${escapeHtml(cell)}</td>`
              })
              .join('')}</tr>`,
        )
        .join('')}
    </tbody>
  </table>`
}

function buildHtmlSummaryTable(rankedHeuristics) {
  return htmlTable({
    className: 'severity-table',
    headers: [
      '#',
      'Heuristica',
      'Pts. Medios',
      'Max.',
      '% Cumplimiento',
      'Severidad',
    ],
    rows: rankedHeuristics.map((heuristic, index) => [
      index + 1,
      `${heuristic.id} — ${heuristic.title}`,
      formatNumber(heuristic.average),
      formatNumber(heuristic.max),
      {
        className: `cell-${colorClassForPercentage(heuristic.compliance)}`,
        value: formatPercentage(heuristic.compliance),
      },
      {
        className: `cell-${colorClassForPercentage(heuristic.compliance)} severity-${heuristic.severity.toLowerCase()}`,
        value: heuristic.severity,
      },
    ]),
  })
}

function buildHtmlFindings(heuristic) {
  const findings = heuristic.evidence.problems
    .filter(
      (problem) =>
        problem.comments.length ||
        problem.warningCount ||
        problem.images.length,
    )
    .slice(0, 5)

  if (!findings.length) return ''

  return `<h4>Hallazgos de los evaluadores:</h4>
  <ul>
    ${findings
      .map((problem) => {
        const comment = problem.comments[0]
        const suffix = problem.warningCount
          ? ` (${problem.warningCount} warning${problem.warningCount > 1 ? 's' : ''})`
          : ''
        return `<li>${escapeHtml(comment || problem.text)}${escapeHtml(suffix)}</li>`
      })
      .join('')}
  </ul>`
}

function buildHtmlQuestions(heuristic) {
  if (!heuristic.questions.length) return ''

  return `<h4>Preguntas evaluadas:</h4>
  <ol>
    ${heuristic.questions
      .map((question) => `<li>${escapeHtml(question.text)}</li>`)
      .join('')}
  </ol>`
}

function buildHtmlImagesLine(heuristic) {
  if (!heuristic.evidence.totalImages) return ''
  return `<p><strong>Evidencia visual:</strong> hay ${heuristic.evidence.totalImages} imagen(es) asociada(s) a esta heuristica.</p>`
}

function buildHtmlRecommendations(heuristic) {
  const recommendations = [
    'Revisar las preguntas con menor puntuacion y convertirlas en tareas accionables.',
    'Validar la mejora repitiendo la misma matriz de evaluadores.',
  ]

  if (heuristic.evidence.warningCount > 0) {
    recommendations.unshift(
      'Resolver primero las respuestas marcadas como warning.',
    )
  }

  if (isMostlyVisualHeuristic(heuristic.title)) {
    recommendations.push(
      'Priorizar cambios visuales que afecten legibilidad, contraste o comprension, no solo estetica.',
    )
  }

  return `<h4>Recomendaciones de mejora:</h4>
  <ul>${recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
}

function buildHtmlHeuristicCard({ heuristic, position, answers }) {
  const evaluatorValues = getEvaluatorValuesForHeuristic(
    answers,
    heuristic.index,
  )
  const evaluatorText = evaluatorValues.length
    ? evaluatorValues
        .map((value) => formatNumber(value).replace(/\.00$/, ''))
        .join(', ')
    : EMPTY_VALUE
  const visualNote = isMostlyVisualHeuristic(heuristic.title)
    ? ' En esta heuristica se modera el impacto porque los aspectos visuales no siempre bloquean la tarea, salvo cuando afectan legibilidad, contraste o comprension.'
    : ''

  return `<section class="heuristic-card">
    <h3>${position}. ${escapeHtml(heuristic.id)} — ${escapeHtml(
      heuristic.title,
    )} <span>[${formatPercentage(heuristic.compliance)} — ${escapeHtml(
      heuristic.severity,
    )}]</span></h3>
    <p class="metric-line"><em>Puntuacion media: ${formatNumber(
      heuristic.average,
    )} / ${formatNumber(heuristic.max)} pts&nbsp;&nbsp;|&nbsp;&nbsp;Cumplimiento: ${formatPercentage(
      heuristic.compliance,
    )}&nbsp;&nbsp;|&nbsp;&nbsp;Evaluadores: ${escapeHtml(evaluatorText)}</em></p>
    <p class="metric-line"><em>Afectados: ${heuristic.evidence.affectedEvaluators} / ${heuristic.evidence.totalEvaluators} evaluador(es) (${formatNumber(
      heuristic.evidence.affectedPercentage,
      1,
    )}%) | Warnings: ${heuristic.evidence.warningCount} | Comentarios: ${heuristic.evidence.totalComments} | Imagenes: ${heuristic.evidence.totalImages}</em></p>
    <p><strong>Que evalua:</strong> Esta heuristica evalua el grado en que el sistema cumple el criterio "${escapeHtml(
      heuristic.title,
    )}" en los flujos revisados.</p>
    ${buildHtmlQuestions(heuristic)}
    <p><strong>Descripcion general de respuestas:</strong> ${escapeHtml(
      buildResponseDescription(heuristic),
    )}</p>
    ${buildHtmlFindings(heuristic)}
    ${buildHtmlImagesLine(heuristic)}
    <h4>Impacto en el usuario:</h4>
    <p>Al no cumplirse suficientemente, la experiencia puede volverse menos clara, mas lenta o mas propensa a errores. El impacto aumenta cuando hay warnings o coincidencia entre evaluadores.${escapeHtml(
      visualNote,
    )}</p>
    <h4>Impacto esperado de la mejora:</h4>
    <p>Si se resuelve, el sistema deberia acercarse a un cumplimiento operativo minimo del 80%, reducir warnings y mejorar la seguridad con la que los usuarios completan las tareas evaluadas.</p>
    ${buildHtmlRecommendations(heuristic)}
  </section>`
}

function buildHtmlEvaluatorMatrix({ test, testAnswerDocument, testOptions }) {
  const answers = getAnswers(testAnswerDocument)
  const evaluatorHeaders = answers.map((_, index) => `Ev${index + 1}`)
  const heuristicCount = Math.max(
    Array.isArray(test?.testStructure) ? test.testStructure.length : 0,
    answers.reduce(
      (max, answer) =>
        Math.max(
          max,
          Array.isArray(answer?.heuristicQuestions)
            ? answer.heuristicQuestions.length
            : 0,
        ),
      0,
    ),
  )

  return htmlTable({
    className: 'evaluator-score-table',
    headers: ['Heuristica', ...evaluatorHeaders],
    rows: Array.from({ length: heuristicCount }, (_, index) => {
      const questions = getHeuristicQuestions({
        test,
        answers,
        heuristicIndex: index,
      })
      const questionCount = questions.length
      const { max: optionMax } = getOptionBounds(testOptions)
      const maxTotal = questionCount ? questionCount * optionMax : 0
      const heuristicLabel = getHeuristicTitle(test, index, `H${index + 1}`)

      return [
        heuristicLabel,
        ...answers.map((answer) => {
          const heuristic = answer?.heuristicQuestions?.[index]
          const qlist = Array.isArray(heuristic?.heuristicQuestions)
            ? heuristic.heuristicQuestions
            : []
          const evaluatorTotal = qlist.length
            ? qlist.reduce(
                (total, question) =>
                  total + toFiniteNumber(getAnswerValue(question)),
                0,
              )
            : 0
          const percentage =
            maxTotal > 0 ? (evaluatorTotal / maxTotal) * 100 : 0
          const colorLabel = colorLabelForPercentage(percentage)

          return {
            className: `score-${colorClassForPercentage(percentage)}`,
            value: `${formatNumber(evaluatorTotal)} [${colorLabel}]`,
          }
        }),
      ]
    }),
  })
}

function buildHtmlTimeSection(evaluatorRows) {
  const evaluatorsWithTime = evaluatorRows.filter((row) => row.timeMs > 0)

  if (!evaluatorsWithTime.length) {
    return '<p>No hay tiempo registrado para los evaluadores en las respuestas del test.</p>'
  }

  const averageMs =
    evaluatorsWithTime.reduce((total, row) => total + row.timeMs, 0) /
    evaluatorsWithTime.length

  return `<p>${escapeHtml(buildTimeParagraph(evaluatorRows))}</p>
  ${htmlTable({
    className: 'time-table',
    headers: [
      'Evaluador',
      'Tiempo',
      'Resultado global',
      'Warnings',
      'Comentarios',
      'Imagenes',
    ],
    rows: evaluatorRows.map((row) => [
      row.label,
      formatMinutes(row.timeMs),
      row.result,
      row.warnings,
      row.comments,
      row.images,
    ]),
  })}
  <p class="metric-line"><em>Tiempo medio: ${formatMinutes(averageMs)}</em></p>`
}

function buildNarrativeHtmlReport({
  test,
  testAnswerDocument,
  generalStatistics,
  statisticsByEvaluator,
  _statisticsByEvaluatorAnswer,
  statisticsByHeuristics,
}) {
  const answers = getAnswers(testAnswerDocument)
  const evaluatorRows = buildEvaluatorRows({ statisticsByEvaluator, answers })
  const evaluatorCount =
    toFiniteNumber(generalStatistics?.evaluators) || evaluatorRows.length
  const rankedHeuristics = buildHeuristicRows({
    test,
    testAnswerDocument,
    statisticsByHeuristics,
    evaluatorCount,
  })
  const globalAverage = generalStatistics?.average || EMPTY_VALUE
  const totalComments = rankedHeuristics.reduce(
    (total, heuristic) => total + heuristic.evidence.totalComments,
    0,
  )
  const totalImages = rankedHeuristics.reduce(
    (total, heuristic) => total + heuristic.evidence.totalImages,
    0,
  )
  const totalWarnings = rankedHeuristics.reduce(
    (total, heuristic) => total + heuristic.evidence.warningCount,
    0,
  )
  const evaluatorsWithWarnings = countEvaluatorsWithWarnings(answers)
  const evaluatorsWithWarningsPercentage = evaluatorCount
    ? ((evaluatorsWithWarnings * 100) / evaluatorCount).toFixed(1)
    : '0.0'

  return `<article class="visual-heuristic-report">
    <style>
      .visual-heuristic-report{font-family:Arial,Helvetica,sans-serif;color:#222}
      .visual-heuristic-report h1{color:#0b57a4;font-size:24px;margin-bottom:8px}
      .visual-heuristic-report h2{color:#0b57a4;border-bottom:1px solid #e6eef7;padding-bottom:6px}
      .visual-heuristic-report .heuristic-card{border:1px solid #e1e7ec;padding:14px;margin:12px 0;background:#fff;border-radius:4px}
      .visual-heuristic-report .heuristic-card h3{color:#0b57a4;margin:0 0 6px}
      .visual-heuristic-report .metric-line{color:#6b7280;font-size:13px;margin:6px 0}
      .severity-table, .evaluator-score-table, .time-table{width:100%;border-collapse:collapse;margin-top:8px}
      .severity-table th, .evaluator-score-table th, .time-table th{background:#0b57a4;color:#fff;padding:8px;text-align:left}
      .severity-table td, .evaluator-score-table td, .time-table td{padding:8px;border:1px solid #e6eef7}
      .cell-rojo{background:#fdecea;color:#b71c1c;font-weight:700}
      .cell-naranja{background:#fff4e5;color:#9a5800;font-weight:700}
      .cell-amarillo{background:#fff8e1;color:#8a6d00;font-weight:700}
      .cell-verde{background:#eaf7ea;color:#1b5e20;font-weight:700}
      .score-rojo{background:#ffd6d6}
      .score-naranja{background:#fff0d6}
      .score-amarillo{background:#fffde0}
      .score-verde{background:#eaffea}
      .visual-heuristic-report ul{margin:8px 0 12px 18px}
      .visual-heuristic-report ol{margin:8px 0 12px 18px; list-style-position: inside; padding-left:18px}
      .visual-heuristic-report ol li{margin:4px 0; padding-left:6px}
      .visual-heuristic-report .report-header p{margin:2px 0}
      .visual-heuristic-report .legend{font-size:12px;color:#6b7280}
      @media (max-width:800px){.visual-heuristic-report{padding:6px}}
    </style>
    <header class="report-header">
      <h1>Informe de evaluacion heuristica</h1>
      <p><strong>Sistema evaluado:</strong> ${escapeHtml(
        test?.testTitle || EMPTY_VALUE,
      )}</p>
      <p><strong>Fecha:</strong> ${formatDate(
        test?.creationDate || new Date(),
      )} &nbsp;|&nbsp; <strong>Evaluadores:</strong> ${evaluatorCount} &nbsp;|&nbsp; <strong>Average usability percentage:</strong> ${escapeHtml(
        globalAverage,
      )} &nbsp;|&nbsp; <strong>Evaluadores con warnings:</strong> ${evaluatorsWithWarnings} (${evaluatorsWithWarningsPercentage}%) &nbsp;|&nbsp; <strong>Total warnings:</strong> ${totalWarnings}</p>

      <section class="statistics-card" style="margin-top:12px">
        <div style="display:flex;align-items:center;border:1px solid #e6eef7;background:#fff;padding:18px;border-radius:6px">
          <div style="flex:1;padding:20px 30px;">
            <div style="color:#6b7280">Usability Percentage</div>
            <div style="font-size:48px;color:#0b57a4;margin-top:6px">${escapeHtml(
              globalAverage,
            )}</div>
          </div>
          <div style="flex:1;border-left:1px solid #eef4fb;padding-left:24px">
            <div style="display:flex;justify-content:space-between;padding:6px 0;color:#6b7280"> <div>Max</div><div>${escapeHtml(
              generalStatistics?.max || EMPTY_VALUE,
            )}</div></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;color:#6b7280"> <div>Min</div><div>${escapeHtml(
              generalStatistics?.min || EMPTY_VALUE,
            )}</div></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;color:#6b7280"> <div>Standard deviation</div><div>${escapeHtml(
              generalStatistics?.sd || EMPTY_VALUE,
            )}</div></div>
          </div>
        </div>
      </section>
    </header>

    <section>
      <h2>1. Introduccion del test</h2>
      <p>${escapeHtml(getTestDescription(test))}</p>
      <p>El informe ordena las heuristicas por impacto negativo, combinando porcentaje medio de cumplimiento, warnings y evidencias registradas. Las heuristicas principalmente visuales moderan su peso si no bloquean tareas funcionales.</p>
      ${
        totalComments || totalImages || totalWarnings
          ? `<p><strong>Evidencias generales:</strong> ${totalComments} comentario(s), ${totalImages} imagen(es), ${totalWarnings} warning(s). Evaluadores con warnings: ${evaluatorsWithWarnings} (${evaluatorsWithWarningsPercentage}%).</p>`
          : ''
      }
    </section>

    <section>
      <h2>2. Heuristicas por impacto negativo</h2>
      ${buildHtmlSummaryTable(rankedHeuristics)}
    </section>

    <section>
      <h2>3. Analisis por heuristica</h2>
      ${rankedHeuristics
        .map((heuristic, index) =>
          buildHtmlHeuristicCard({
            heuristic,
            position: index + 1,
            answers,
          }),
        )
        .join('')}
    </section>

    <section>
      <h2>4. Tiempo de evaluacion</h2>
      ${buildHtmlTimeSection(evaluatorRows)}
    </section>

    <section>
      <h2>5. Comparativa de puntuaciones por evaluador</h2>
      <p>La siguiente tabla muestra la puntuacion bruta otorgada por cada evaluador para cada heuristica, permitiendo identificar divergencias de criterio.</p>
      ${buildHtmlEvaluatorMatrix({
        test,
        testAnswerDocument,
        testOptions: test?.testOptions,
      })}
      <p class="legend">Rojo = valoracion muy baja; naranja = baja; amarillo = media; verde = alta.</p>
    </section>

    <section>
      <h2>6. Conclusion final</h2>
      <p>${escapeHtml(
        buildConclusion({
          globalAverage,
          rankedHeuristics,
          totalWarnings,
          totalComments,
          totalImages,
        }),
      ).replace(/\n\n/g, '</p><p>')}</p>
    </section>
  </article>`
}

function buildNarrativeTextReport({
  test,
  testAnswerDocument,
  generalStatistics,
  statisticsByEvaluator,
  _statisticsByEvaluatorAnswer,
  statisticsByHeuristics,
  heuristicComments = {},
}) {
  const answers = getAnswers(testAnswerDocument)
  const evaluatorRows = buildEvaluatorRows({ statisticsByEvaluator, answers })
  const evaluatorCount =
    toFiniteNumber(generalStatistics?.evaluators) || evaluatorRows.length
  const rankedHeuristics = buildHeuristicRows({
    test,
    testAnswerDocument,
    statisticsByHeuristics,
    evaluatorCount,
  })
  const globalAverage = generalStatistics?.average || EMPTY_VALUE
  const totalComments = rankedHeuristics.reduce(
    (total, heuristic) => total + heuristic.evidence.totalComments,
    0,
  )
  const totalImages = rankedHeuristics.reduce(
    (total, heuristic) => total + heuristic.evidence.totalImages,
    0,
  )
  const totalWarnings = rankedHeuristics.reduce(
    (total, heuristic) => total + heuristic.evidence.warningCount,
    0,
  )
  const conclusion = stripHtml(test?.studyConclusion || '')
  const manualComments = Object.entries(heuristicComments || {})
    .filter(([, comment]) => String(comment || '').trim())
    .map(([heuristicId, comment]) => {
      const heuristic = (test?.testStructure || []).find(
        (item) => String(item.id) === String(heuristicId),
      )
      const title =
        heuristic?.title ||
        heuristic?.name ||
        heuristic?.heuristicTitle ||
        heuristicId
      return `- ${title}: ${stripHtml(comment)}`
    })
    .join('\n')

  return [
    '============================================================',
    'INFORME DE EVALUACION HEURISTICA',
    '============================================================',
    '',
    `Sistema evaluado: ${test?.testTitle || EMPTY_VALUE}`,
    `Fecha del test: ${formatDate(test?.creationDate || new Date())}`,
    `Evaluadores: ${evaluatorCount}`,
    `Average usability percentage: ${globalAverage}`,
    `Descripcion del test: ${getTestDescription(test)}`,
    '',
    sectionTitle(1, 'Introduccion del test'),
    '',
    `Este informe analiza los resultados de la evaluacion heuristica usando los datos reales del apartado Answer. La interpretacion se basa en el average usability percentage de cada heuristica, las respuestas marcadas como warning, los comentarios, las imagenes y los tiempos de evaluacion registrados.`,
    `El objetivo es ordenar las heuristicas por impacto negativo: primero aparecen las que tienen bajo porcentaje de cumplimiento y mayor oportunidad de mejora. Si una heuristica esta relacionada principalmente con estilo o diseno visual, su impacto se modera porque no siempre implica una mejora funcional proporcional en la web.`,
    ...(totalComments || totalImages
      ? [
          '',
          `Evidencias generales: hay ${totalComments} comentario(s) y ${totalImages} imagen(es) en la evaluacion.`,
        ]
      : []),
    '',
    sectionTitle(2, 'Tabla de heuristicas, cumplimiento y severidad'),
    '',
    buildHeuristicSummaryTable(rankedHeuristics),
    '',
    sectionTitle(3, 'Analisis por heuristica en orden de impacto negativo'),
    '',
    rankedHeuristics
      .map((heuristic, index) => buildHeuristicAnalysis(heuristic, index + 1))
      .join(
        '\n\n------------------------------------------------------------\n\n',
      ),
    '',
    sectionTitle(4, 'Tiempo de evaluacion'),
    '',
    buildTimeParagraph(evaluatorRows),
    '',
    textTable(
      [
        'Evaluador',
        'Resultado global',
        'Tiempo',
        'Warnings',
        'Comentarios',
        'Imagenes',
      ],
      evaluatorRows.map((row) => [
        row.label,
        row.result,
        formatMinutes(row.timeMs),
        row.warnings,
        row.comments,
        row.images,
      ]),
    ),
    '',
    sectionTitle(5, 'Tabla final de heuristicas, evaluadores y valoraciones'),
    '',
    'Leyenda de color: ROJO = valoracion muy baja, NARANJA = baja, AMARILLO = media, VERDE = alta.',
    '',
    buildEvaluatorMatrixTable({
      test,
      testAnswerDocument,
      testOptions: test?.testOptions,
    }),
    ...(manualComments
      ? [
          '',
          sectionTitle(6, 'Comentarios de sintesis introducidos en el informe'),
          '',
          manualComments,
        ]
      : []),
    '',
    sectionTitle(manualComments ? 7 : 6, 'Conclusion final'),
    '',
    buildConclusion({
      globalAverage,
      rankedHeuristics,
      totalWarnings,
      totalComments,
      totalImages,
    }),
    ...(conclusion ? ['', 'Conclusion manual del estudio:', conclusion] : []),
    '',
    'FIN DEL INFORME',
  ].join('\n')
}

export { buildNarrativeHtmlReport, buildNarrativeTextReport }
