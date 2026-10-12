/**
 * Detecta si las 15 heurísticas de un test coinciden con el set estándar
 * de Nielsen + Tognazzini. No tiene relación con la construcción de
 * prompts — vivía dentro de aiReportPrompt.js solo porque el texto del
 * prompt menciona la metodología detectada.
 */

import { normalizeForFuzzyMatch as normalizeHeuristicName } from './reportHelpers'

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
 * Cálculo simple de similitud (Jaccard sobre palabras)
 */
function similarity(a, b) {
  const wordsA = new Set(a.split(' ').filter(Boolean))
  const wordsB = new Set(b.split(' ').filter(Boolean))
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return union > 0 ? intersection / union : 0
}

/**
 * Detecta si las heurísticas del test coinciden con las 15 de Nielsen + Tognazzini
 * @param {Array} testStructure - Array de heurísticas del test con título/name
 * @returns {boolean} true si coincide al menos 12 de 15 (80% threshold)
 */
export function detectNielsenTognazziniMethodology(testStructure = []) {
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
