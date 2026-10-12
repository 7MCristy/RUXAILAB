/**
 * Proveedor Ollama — todo lo específico del fallback local: comprobación
 * de disponibilidad, construcción y ejecución del plan de llamadas (varias
 * peticiones pequeñas en vez de una grande), y ensamblaje del informe.
 */

import { buildOllamaPlan } from '@/ux/Heuristic/utils/aiReportPromptOllama'
import { assembleOllamaReport } from '@/ux/Heuristic/utils/ollamaResponseParser'
import { researchWebsite } from '../webSearchService'
import { OLLAMA_TIMEOUT_MS, ENABLE_WEB_RESEARCH } from './aiConfig'

export const PROVIDER_NAME = 'ollama'

async function checkOllamaAvailable(
  tagsUrl = 'http://localhost:11434/api/tags',
) {
  const startedAt = Date.now()

  try {
    console.log('[Ollama] Comprobando disponibilidad:', tagsUrl)
    const response = await fetch(tagsUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })

    console.log('[Ollama] Disponibilidad HTTP:', {
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    })
    return response.ok
  } catch (error) {
    console.error('[Ollama] No se pudo consultar /api/tags:', {
      url: tagsUrl,
      name: error?.name,
      message: error?.message,
      durationMs: Date.now() - startedAt,
    })
    return false
  }
}

/**
 * Genera informe con Ollama usando múltiples llamadas pequeñas.
 *
 * Arquitectura:
 * - Llamada 1: Introducción + Porcentajes (con web research si disponible)
 * - Llamada 2+: Análisis heurístico por lotes (JSON forzado)
 * - Última llamada: Conclusión (con web research ya obtenido)
 *
 * @param {Object} finalReportItem - Datos del informe
 * @param {string} ollamaUrl - URL de Ollama (default: localhost:11434)
 * @returns {Promise<Object>} { content, sections, webResearch, source }
 */
export async function generateAiReportWithOllama(
  finalReportItem,
  ollamaUrl = process.env.VUE_APP_OLLAMA_API_URL ||
    'http://localhost:11434/api/chat',
) {
  const model = process.env.VUE_APP_OLLAMA_MODEL || 'qwen2.5:3b'

  console.log('[Ollama] Inicio de generación:', {
    url: ollamaUrl,
    model,
  })

  // Verificar disponibilidad usando la URL directa de /api/tags
  // Construir URL de tags a partir de la URL base (sin /api/chat)
  const baseUrl = ollamaUrl.replace(/\/api\/chat\/?$/, '')
  const tagsUrl = `${baseUrl}/api/tags`

  const isAvailable = await checkOllamaAvailable(tagsUrl)
  if (!isAvailable) {
    throw new Error('Ollama no está disponible')
  }

  // Investigación web RAG
  let webResearchContent = ''
  if (ENABLE_WEB_RESEARCH) {
    try {
      console.log('[Ollama] 🌐 Iniciando investigación web...')
      const webResult = await researchWebsite({
        testUrl: finalReportItem.testUrl,
        testDescription: finalReportItem.testDescription,
        testTitle: finalReportItem.title,
      })
      webResearchContent = webResult.content
      console.log('[Ollama] ✅ Investigación web completada:', {
        source: webResult.source,
        contentLength: webResearchContent.length,
      })
    } catch (webError) {
      console.warn('[Ollama] ⚠️ Investigación web falló:', webError.message)
    }
  } else {
    console.log('[Ollama] ⚠️ Investigación web deshabilitada')
  }

  // Construir plan (múltiples llamadas)
  const plan = buildOllamaPlan(finalReportItem, model, webResearchContent)
  console.log('[Ollama] 📋 Plan:', {
    totalCalls: plan.calls.length,
    calls: plan.calls.map((c) => c.key),
    meta: plan.meta,
    timeoutMs: OLLAMA_TIMEOUT_MS,
  })

  // ─── Ejecutar llamadas en paralelo (máx 3 concurrentes) ──────────────
  const MAX_CONCURRENT = 3
  const MAX_ATTEMPTS = 2
  const results = {}
  const startedAt = Date.now()

  console.log('[Ollama] 🔧 Config:', {
    timeout: OLLAMA_TIMEOUT_MS,
    maxConcurrent: MAX_CONCURRENT,
    maxAttempts: MAX_ATTEMPTS,
  })

  async function callOllamaOnce(call, workerId) {
    console.log(
      `[Ollama] 🌐 Worker ${workerId} → ${call.key}: Iniciando fetch...`,
    )
    const fetchStarted = Date.now()

    const response = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(call.requestBody),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    })

    console.log(
      `[Ollama] 🌐 Worker ${workerId} → ${call.key}: HTTP ${response.status} (${Date.now() - fetchStarted}ms)`,
    )

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 300)
      throw new Error(`HTTP ${response.status}: ${errorBody}`)
    }

    console.log(
      `[Ollama] 🌐 Worker ${workerId} → ${call.key}: Parseando JSON...`,
    )
    const data = await response.json()

    console.log(
      `[Ollama] 🌐 Worker ${workerId} → ${call.key}: done=${data?.done}, eval_count=${data?.eval_count}`,
    )

    const content = String(data?.message?.content || '').trim()
    console.log(
      `[Ollama] 🌐 Worker ${workerId} → ${call.key}: contenido extraído = ${content.length} chars`,
    )

    if (!content) throw new Error('Respuesta vacía del modelo')
    return content
  }

  async function callWithRetry(call, workerId) {
    const taskIndex = plan.calls.findIndex((c) => c.key === call.key)
    console.log(
      `[Ollama] 📌 Worker ${workerId} tomó tarea ${taskIndex + 1}/${plan.calls.length}: ${call.key}`,
    )

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(
          `[Ollama] ⏱️ Worker ${workerId} → ${call.key}: intento ${attempt}/${MAX_ATTEMPTS}...`,
        )
        const content = await callOllamaOnce(call, workerId)
        console.log(
          `[Ollama] ✅ Worker ${workerId} → ${call.key}: ÉXITO (intento ${attempt})`,
        )
        return { key: call.key, content, error: null }
      } catch (err) {
        console.warn(
          `[Ollama] ⚠️ Worker ${workerId} → ${call.key}: FALLO intento ${attempt}/${MAX_ATTEMPTS}:`,
          err.message,
        )
        if (attempt < MAX_ATTEMPTS) {
          const waitMs = 2000 * attempt
          console.log(
            `[Ollama] ⏳ Worker ${workerId} → ${call.key}: Esperando ${waitMs}ms antes de reintentar...`,
          )
          await new Promise((r) => setTimeout(r, waitMs))
        }
      }
    }
    console.error(
      `[Ollama] ❌ Worker ${workerId} → ${call.key}: AGOTÓ TODOS LOS REINTENTOS`,
    )
    return {
      key: call.key,
      content: null,
      error: 'Todos los reintentos fallaron',
    }
  }

  // Lanzar todas las tareas en paralelo con concurrencia limitada
  const tasks = plan.calls.map((call) => () => callWithRetry(call, 0))
  let cursor = 0

  console.log('[Ollama] 🚀 Lanzando workers:', {
    totalTasks: tasks.length,
    workers: Math.min(MAX_CONCURRENT, tasks.length),
  })

  async function worker(workerId) {
    console.log(`[Ollama] 👷 Worker ${workerId} iniciado`)
    while (cursor < tasks.length) {
      const i = cursor++
      console.log(
        `[Ollama] 👷 Worker ${workerId}: procesando tarea ${i + 1}/${tasks.length}`,
      )
      const result = await tasks[i]()
      results[result.key] = result.content
      console.log(
        `[Ollama] 👷 Worker ${workerId}: tarea ${i + 1} guardada en results["${result.key}"] = ${result.content ? result.content.length + ' chars' : 'NULL'}`,
      )
    }
    console.log(
      `[Ollama] 👷 Worker ${workerId}: no hay más tareas, terminando`,
    )
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, tasks.length) }, (_, i) =>
      worker(i),
    ),
  )

  console.log(
    '[Ollama] 🔍 Todos los workers terminaron. Results keys:',
    Object.keys(results),
  )

  const exitosas = Object.values(results).filter(Boolean).length
  const fallidas = Object.values(results).filter((v) => v === null).length
  console.log('[Ollama] 📊 Resumen ejecución:', {
    total: plan.calls.length,
    exitosas,
    fallidas,
    totalDurationMs: Date.now() - startedAt,
  })

  for (const call of plan.calls) {
    const val = results[call.key]
    console.log(
      `[Ollama] 📋 result["${call.key}"] = ${val ? `${val.length} chars` : 'NULL'}`,
    )
  }

  if (fallidas > 0) {
    const fallidasKeys = plan.calls
      .filter((c) => !results[c.key])
      .map((c) => c.key)
      .join(', ')
    throw new Error(
      `Faltan respuestas de Ollama (${fallidas}/${plan.calls.length}): ${fallidasKeys}. No se puede generar el PDF incompleto.`,
    )
  }

  if (exitosas === 0) {
    throw new Error('Todas las llamadas a Ollama fallaron')
  }

  console.log('[Ollama] 🏗️ Iniciando ensamblaje...')
  console.log('[Ollama] 🏗️ Results antes de ensamblar:', {
    intro_porcentajes: results.intro_porcentajes ? 'OK' : 'NULL',
    analisis_lotes: plan.calls
      .filter((c) => c.key.startsWith('analisis_lote_'))
      .map((c) => `${c.key}: ${results[c.key] ? 'OK' : 'NULL'}`)
      .join(', '),
    conclusion: results.conclusion ? 'OK' : 'NULL',
  })

  const assembled = assembleOllamaReport(
    results,
    plan.meta.sortedByImpact || [],
  )

  console.log('[Ollama] 📊 Ensamblaje completado:', {
    introduccion: assembled.introduccion.length,
    porcentajes: assembled.porcentajes.length,
    tipos_respuesta: assembled.tipos_respuesta.length,
    analisisBlocks: assembled.analisis_heuristico_blocks.length,
    comparativa: assembled.comparativa.length,
    conclusion: assembled.conclusion.length,
    totalDurationMs: Date.now() - startedAt,
  })

  const fullContent = [
    assembled.introduccion,
    assembled.porcentajes,
    assembled.tipos_respuesta,
    assembled.analisis_heuristico,
    assembled.comparativa,
    assembled.conclusion,
  ]
    .filter(Boolean)
    .join('\n\n')

  console.log('[Ollama] 🧾 Texto final ensamblado:', {
    totalChars: fullContent.length,
    approxTokens: Math.ceil(fullContent.length / 3.5),
    sections: {
      introduccion: assembled.introduccion.length,
      porcentajes: assembled.porcentajes.length,
      tipos_respuesta: assembled.tipos_respuesta.length,
      analisis_heuristico: assembled.analisis_heuristico.length,
      comparativa: assembled.comparativa.length,
      conclusion: assembled.conclusion.length,
    },
    preview: {
      introduccion: assembled.introduccion.slice(0, 220),
      conclusion: assembled.conclusion.slice(0, 220),
    },
  })

  return {
    content: fullContent,
    sections: assembled,
    webResearch: webResearchContent,
    source: 'ollama',
  }
}
