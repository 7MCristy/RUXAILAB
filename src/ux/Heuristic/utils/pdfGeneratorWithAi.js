/**
 * Re-exporta generateHeuristicPdfWithAi desde pdfGenerator.js
 * para mantener compatibilidad con imports existentes.
 *
 * pdfGenerator.js contiene AMBAS funciones:
 * - generateHeuristicPdf (export original)
 * - generateHeuristicPdfWithAi (alias)
 *
 * La diferenciación entre informe "sin IA" y "con IA" se hace en
 * FinalReportSelectionBox.vue mediante la inyección de contenido
 * generado por Gemini/Ollama en reportItem.finalReport / reportItem.studyConclusion,
 * NO en el motor de generación PDF.
 */

import { generateHeuristicPdfWithAi } from './pdfGenerator'
export { generateHeuristicPdfWithAi }
export default generateHeuristicPdfWithAi
