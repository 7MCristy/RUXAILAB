/**
 * ORQUESTADOR DE GENERACIÓN DE INFORMES CON IA PARA RUXAILAB
 *
 * Implementa una cadena de responsabilidad (Chain of Responsibility) de 3
 * eslabones, cada uno delegado a su propio módulo:
 *   1. Gemini API (./ai/geminiProvider)  — nube, alta calidad, con cuota.
 *   2. Ollama local (./ai/ollamaProvider) — sin dependencia de red ni cuota.
 *   3. Fallback vacío                     — el PDF usa sus textos de respaldo.
 *
 * Cada proveedor es intercambiable (patrón Strategy): expone su propia
 * función `generate*(finalReportItem, ...)` y este orquestador solo decide
 * el orden y qué hacer cuando uno falla. Ningún proveedor conoce al otro.
 */

import {
  generateAiReportWithGemini,
  correctCommentsWithAI,
  testGeminiConnection,
  validateApiKey,
  isGeminiConfigured,
} from './ai/geminiProvider'
import { generateAiReportWithOllama } from './ai/ollamaProvider'
import {
  parseAiReportSections,
  parseHeuristicAnalysis,
} from './ai/aiReportParsers'
import { hasQuota, trackTokens, estimateTokens } from './tokenTracker'

function emptyFallbackResult() {
  console.log(
    '[AI] ⚠️ AMBAS IAs fallaron. El PDF usará sus textos de respaldo.',
  )
  console.log('[AI] ===== FIN GENERACIÓN (Sin IA) =====')
  return {
    content: '',
    webResearch: '',
    source: 'fallback',
    sections: {
      introduccion: '',
      porcentajes: '',
      tipos_respuesta: '',
      analisis_heuristico: '',
      analisis_heuristico_blocks: [],
      comparativa: '',
      conclusion: '',
    },
  }
}

/**
 * Eslabón Gemini de la cadena: genera, registra el consumo de tokens y
 * normaliza la forma del resultado. Si la cuota está agotada, no intenta
 * la llamada (deja pasar directamente al siguiente eslabón).
 */
async function tryGemini(finalReportItem) {
  const result = await generateAiReportWithGemini(finalReportItem)
  const inputTokens = estimateTokens(result.userPrompt || '')
  const outputTokens = estimateTokens(result.content || '')
  trackTokens('gemini', inputTokens + outputTokens)
  return {
    ...result,
    sections: result.sections || parseAiReportSections(result.content),
    source: 'gemini',
  }
}

/**
 * Eslabón Ollama de la cadena: genera y normaliza la forma del resultado.
 */
async function tryOllama(finalReportItem, ollamaUrl) {
  const result = await generateAiReportWithOllama(finalReportItem, ollamaUrl)
  return {
    ...result,
    sections: result.sections || parseAiReportSections(result.content),
    source: 'ollama',
  }
}

/**
 * Genera informe con estrategia de fallback:
 * 1. Intenta con Gemini API (si hay cuota y no se pide saltarlo)
 * 2. Si falla, intenta con Ollama local (si no se pide saltarlo)
 * 3. Si ambos fallan, devuelve una sección vacía (el PDF usa su respaldo)
 *
 * @param {Object} finalReportItem - Datos del informe
 * @param {Object} options - { ollamaUrl, skipGemini, skipOllama }
 * @returns {Promise<Object>} { content, sections, webResearch, source }
 */
export async function generateAiReportWithFallback(
  finalReportItem,
  options = {},
) {
  const {
    ollamaUrl = process.env.VUE_APP_OLLAMA_API_URL ||
      'http://localhost:11434/api/chat',
    skipGemini = false,
    skipOllama = false,
  } = options

  console.log('[AI] ===== INICIO GENERACIÓN INFORME CON IA =====')
  console.log('[AI] Opciones:', { skipGemini, skipOllama, ollamaUrl })
  console.log('[AI] Resumen datos entrada:', {
    titulo: finalReportItem?.title,
    heuristicas: finalReportItem?.statisticsByHeuristics?.items?.length || 0,
    evaluadores: finalReportItem?.statisticsTable?.items?.length || 0,
    respuestas: finalReportItem?.allAnswers?.length || 0,
    cumplimientoGlobal: finalReportItem?.generalStatistics?.average,
  })

  // Eslabón 1: Gemini (a menos que se omita o no tenga cuota)
  if (!skipGemini && hasQuota('gemini')) {
    try {
      return await tryGemini(finalReportItem)
    } catch (geminiError) {
      if (
        geminiError.message.includes('429') ||
        geminiError.message.includes('quota')
      ) {
        trackTokens('gemini', 250000)
      }
      if (skipOllama) {
        throw geminiError
      }
      // Cae al siguiente eslabón de la cadena.
    }
  }

  // Eslabón 2: Ollama local
  if (!skipOllama) {
    try {
      return await tryOllama(finalReportItem, ollamaUrl)
    } catch (ollamaError) {
      console.error('[AI] ❌ Ollama falló:', ollamaError.message)
    }
  }

  // Eslabón 3: fallback vacío — el PDF usa sus propios textos de respaldo
  return emptyFallbackResult()
}

/**
 * Hook para usar en Vue - detecta automáticamente qué usar
 */
export async function useAiReport(finalReportItem, options = {}) {
  const useGemini = options.useGemini !== false
  const useFallback = options.useFallback !== false

  if (useGemini && isGeminiConfigured()) {
    if (useFallback) {
      return generateAiReportWithFallback(finalReportItem, options)
    }
    return generateAiReportWithGemini(finalReportItem)
  }

  // Fallback a Ollama
  return generateAiReportWithOllama(finalReportItem, options.ollamaUrl)
}

export {
  generateAiReportWithGemini,
  generateAiReportWithOllama,
  correctCommentsWithAI,
  testGeminiConnection,
  validateApiKey,
  parseAiReportSections,
  parseHeuristicAnalysis,
}

export default {
  generateAiReportWithGemini,
  generateAiReportWithOllama,
  generateAiReportWithFallback,
  useAiReport,
  testGeminiConnection,
  validateApiKey,
  correctCommentsWithAI,
}
