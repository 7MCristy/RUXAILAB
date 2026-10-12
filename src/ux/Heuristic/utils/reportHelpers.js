/**
 * Helpers de texto y datos compartidos entre el motor de renderizado del PDF
 * (pdfGenerator.js) y el constructor de evidencia (buildHeuristicEvidence.js).
 *
 * Viven aquí, y no en pdfGenerator.js, para que buildHeuristicEvidence.js
 * (una capa de preparación de datos) nunca dependa del renderizador de PDF.
 */

function normalizeText(value) {
  if (value && typeof value === 'object') {
    if (typeof value.content === 'string') return normalizeText(value.content)
    if (typeof value.text === 'string') return normalizeText(value.text)
    if (typeof value.value === 'string') return normalizeText(value.value)
    try {
      return normalizeText(JSON.stringify(value))
    } catch {
      return ''
    }
  }

  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\[([^\]]+)\]$/gm, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
  return `Evaluador/a ${index + 1}`
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

/**
 * Normaliza un texto para comparación difusa (sin acentos, minúsculas,
 * solo alfanumérico). Usado para emparejar títulos de heurísticas libres
 * (como los devuelve un LLM) contra los datos reales del test.
 */
function normalizeForFuzzyMatch(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export {
  normalizeText,
  stripHtml,
  stripMarkdown,
  getNumber,
  getHeuristicLabel,
  getHeuristicShortTitle,
  getEvaluatorLabel,
  getQuestionLabel,
  getHeuristicDomainWeight,
  getMaxQuestionScore,
  calculateHeuristicCompliance,
  normalizeForFuzzyMatch,
}
