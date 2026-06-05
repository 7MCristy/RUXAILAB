const DEFAULT_MODEL = 'qwen3'

export const SYSTEM_PROMPT = `
Eres un consultor senior especializado en UX Research y evaluación heurística, con más de 10 años de experiencia realizando auditorías de usabilidad para productos digitales.

Tu función es redactar informes de evaluación heurística profesionales, rigurosos y accionables. Cada informe debe parecer escrito por un experto humano que ha analizado el sistema en profundidad.

NORMAS OBLIGATORIAS:
- Redacta SIEMPRE en español formal con tono académico-profesional, como un consultor externo.
- Cada afirmación debe basarse en los datos proporcionados. NO inventes porcentajes, puntuaciones ni hallazgos.
- Si un dato no está disponible, indícalo con "Dato no disponible".
- INTERPRETA los datos cualitativamente: no te limites a repetir números, explica QUÉ SIGNIFICAN para la experiencia del usuario y QUÉ IMPLICAN para el negocio.
- Las recomendaciones deben ser ACCIONABLES, específicas y priorizadas. Nada de "mejorar la usabilidad".
- NO incluyas encabezados Markdown (# o ##). El PDF los genera automáticamente.
- NO incluyas etiquetas <think>, ni razonamiento interno.
- Devuelve SOLO el texto del informe, sin prefacios ni explicaciones.
- Varía el vocabulario entre secciones. No repitas las mismas frases de transición.
- USA VOCABULARIO TÉCNICO DE UX: "fricción", "carga cognitiva", "affordance", "feedback", "consistencia", "heurística", "tasa de error", "eficiencia", "satisfacción percibida".
- NO uses relleno. Cada frase debe aportar información concreta y valor analítico.
`.trim()

function toFiniteNumber(value, fallback = null) {
  const numericValue = Number.parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getSeverity(compliance) {
  const value = toFiniteNumber(compliance)
  if (value == null) return 'Dato no disponible'
  if (value < 50) return 'Crítico'
  if (value < 75) return 'Moderado'
  if (value < 90) return 'Leve'
  return 'Óptimo'
}

function getHeuristicIndex(name = '') {
  const match = String(name).match(/\d+/)
  return match ? Number(match[0]) - 1 : -1
}

function getHeuristicTitle(heuristicStat, testStructure = []) {
  const index = getHeuristicIndex(heuristicStat?.name)
  const heuristic = testStructure[index]
  return (
    heuristic?.title ||
    heuristic?.name ||
    heuristicStat?.title ||
    heuristicStat?.name ||
    'Dato no disponible'
  )
}

function getWarningsByHeuristic(reportItem, heuristicName) {
  const rows = reportItem?.statisticsByEvaluatorAnswer?.items || []
  const row = rows.find((item) => item?.heuristic === heuristicName)
  if (!row) return 0
  return Object.entries(row)
    .filter(([key]) => key.startsWith('Ev'))
    .reduce((total, [, value]) => {
      const numericValue = toFiniteNumber(value, 0)
      return total + (numericValue < 0 ? 1 : 0)
    }, 0)
}

function getQuestionSummaries(reportItem, heuristicIndex) {
  const testStructure = reportItem?.testStructure || []
  const allAnswers = reportItem?.allAnswers || []
  const heuristic = testStructure[heuristicIndex]
  if (!heuristic) return []

  const questions = Array.isArray(heuristic?.questions)
    ? heuristic.questions
    : Array.isArray(heuristic?.heuristicQuestions)
      ? heuristic.heuristicQuestions
      : []

  return questions.map((question, questionIndex) => {
    const values = allAnswers
      .map((answer) => answer?.heuristicQuestions?.[heuristicIndex]?.heuristicQuestions?.[questionIndex]?.heuristicAnswer?.value)
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number)

    const warnings = allAnswers.filter(
      (answer) => answer?.heuristicQuestions?.[heuristicIndex]?.heuristicQuestions?.[questionIndex]?.heuristicAnswer?.warning === true,
    ).length

    const avg = values.length
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : null

    const maxPossible = Math.max(...values, 1)

    const title = question?.title || question?.question || question?.name || `Pregunta ${questionIndex + 1}`

    return {
      title: stripHtml(title),
      average: avg != null ? avg : null,
      averagePercent: avg != null && maxPossible > 0 ? ((avg / maxPossible) * 100).toFixed(1) + '%' : 'N/D',
      maxPossible,
      evaluatorCount: values.length,
      warnings,
      values: values.map((v) => v.toFixed(1)),
    }
  })
}

function formatQuestionSummary(questions) {
  if (!questions.length) return '  No hay datos de preguntas disponibles.'
  return questions
    .map((q, i) => {
      const warningTag = q.warnings > 0 ? ` ⚠️ (${q.warnings} warning${q.warnings > 1 ? 's' : ''})` : ''
      return `  ${i + 1}. "${q.title}" → Media: ${q.average != null ? q.average.toFixed(2) + '/' + q.maxPossible + ' (' + q.averagePercent + ')' : 'N/D'}${warningTag}`
    })
    .join('\n')
}

function formatEvaluatorsSummary(evaluators = []) {
  if (!evaluators.length) return 'No hay datos de evaluadores disponibles.'
  return evaluators
    .map((ev, i) => {
      const pct = toFiniteNumber(ev?.result ?? ev?.percentage)
      const email = ev?.email || ev?.name || 'Anónimo'
      const score = pct != null ? pct.toFixed(2) + '%' : 'N/D'
      return `- Evaluador ${i + 1} (${email}): ${score}`
    })
    .join('\n')
}

function classifyHeuristics(heuristics = []) {
  const optimal = heuristics.filter((h) => (h.compliance ?? 0) >= 90)
  const warning = heuristics.filter(
    (h) => (h.compliance ?? 0) >= 75 && (h.compliance ?? 0) < 90,
  )
  const critical = heuristics.filter((h) => (h.compliance ?? 0) < 75)
  return { optimal, warning, critical }
}

function buildHeuristicDetailData(reportItem, heuristicStats) {
  return heuristicStats.map((item, index) => {
    const questions = getQuestionSummaries(reportItem, index)
    return {
      name: item.name,
      title: getHeuristicTitle(item, reportItem?.testStructure || []),
      compliance: toFiniteNumber(item?.percentage),
      severity: getSeverity(toFiniteNumber(item?.percentage)),
      standardDeviation: toFiniteNumber(item?.sd),
      average: toFiniteNumber(item?.average),
      max: toFiniteNumber(item?.max),
      min: toFiniteNumber(item?.min),
      warnings: getWarningsByHeuristic(reportItem, item?.name),
      questionSummary: formatQuestionSummary(questions),
      questions,
      manualComment: reportItem?.heuristicComments?.[
        reportItem?.testStructure?.[index]?.id
      ] || '',
    }
  })
}

export function buildHeuristicReportPrompt(reportItem) {
  const heuristicStats = reportItem?.statisticsByHeuristics?.items || []
  const generalStatistics = reportItem?.generalStatistics || {}
  const evaluatorItems = reportItem?.statisticsTable?.items || []
  const testName = reportItem?.title || 'Dato no disponible'
  const testUrl = reportItem?.testUrl || ''
  const testDescription = stripHtml(reportItem?.testDescription)
  const globalCompliance = toFiniteNumber(generalStatistics?.average)
  const globalSeverity = getSeverity(globalCompliance)
  const heuristics = buildHeuristicDetailData(reportItem, heuristicStats)
  const globalWarnings = heuristics.reduce((total, h) => total + (h.warnings || 0), 0)
  const { optimal, critical } = classifyHeuristics(heuristics)
  const sortedByImpact = [...heuristics].sort(
    (a, b) => (a.compliance ?? 100) - (b.compliance ?? 100),
  )
  const top3Critical = sortedByImpact.slice(0, 3)
  const evaluatorSummary = formatEvaluatorsSummary(evaluatorItems)

  const heuristicsDetailText = sortedByImpact.map((h, i) => {
    const rank = i + 1
    return `
--- Heurística #${rank}: ${h.title} (${h.compliance != null ? h.compliance.toFixed(2) + '%' : 'N/D'}) ---
  Severidad: ${h.severity}
  Desviación típica: ${h.standardDeviation != null ? h.standardDeviation.toFixed(2) : 'N/D'}
  Rango de puntuaciones: ${h.min != null ? h.min.toFixed(2) : 'N/D'} - ${h.max != null ? h.max.toFixed(2) : 'N/D'}
  Warnings: ${h.warnings}
  Preguntas:
${h.questionSummary}
  Comentarios de evaluadores: ${h.manualComment ? `"${h.manualComment}"` : 'Sin comentarios'}
`.trim()
  }).join('\n\n')

  const highSdHeuristics = [...heuristics]
    .filter((h) => h.standardDeviation != null)
    .sort((a, b) => (b.standardDeviation ?? 0) - (a.standardDeviation ?? 0))
    .slice(0, 5)
    .map((h) => ({
      name: h.title,
      sd: h.standardDeviation,
      compliance: h.compliance,
    }))

  const evaluatorScoresText = evaluatorItems.length
    ? evaluatorItems
        .map((ev, i) => {
          const pct = toFiniteNumber(ev?.result ?? ev?.percentage)
          return `  Evaluador ${i + 1}: ${pct != null ? pct.toFixed(2) + '%' : 'N/D'}`
        })
        .join('\n')
    : '  No disponibles'

  return `
Genera un INFORME DE EVALUACIÓN HEURÍSTICA profesional con las 6 secciones que se indican a continuación.

INSTRUCCIONES CRÍTICAS:
- Escribe como un consultor senior de UX que ha analizado personalmente el sitio web.
- Cada sección debe basarse ESTRICTAMENTE en los datos proporcionados más abajo.
- No te limites a describir los datos: INTERPRÉTALOS. Explica qué significan para el usuario real.
- Haz referencias concretas al tipo de sitio web y su contexto de uso (basándote en la URL y descripción).
- Las recomendaciones deben ser específicas, técnicas y aplicables directamente al sistema evaluado.
- Mantén un tono profesional, riguroso y útil para un equipo de producto.

DATOS DEL SISTEMA EVALUADO:
- Nombre: ${testName}
- URL: ${testUrl || 'No especificada'}
- Descripción: ${testDescription || 'No disponible'}
- Cumplimiento global: ${globalCompliance != null ? globalCompliance.toFixed(2) + '%' : 'N/D'}
- Severidad global: ${globalSeverity}
- Total de warnings: ${globalWarnings}

PUNTUACIONES POR EVALUADOR:
${evaluatorSummary}

================================================================
SECCION 1 - INTRODUCCION
================================================================
Redacta 4-5 frases en prosa continua que:
1. Presenten el sistema evaluado (nombre y URL), indicando qué tipo de sitio web o aplicación es.
2. Contextualicen la evaluación heurística: por qué es relevante, qué metodología se usó (Nielsen + ISO 9241-110).
3. Indiquen cuántos evaluadores participaron y el contexto de la evaluación.
4. Mencionen el cumplimiento global (${globalCompliance != null ? globalCompliance.toFixed(2) + '%' : 'N/D'}) y su severidad (${globalSeverity}) como dato de partida.
5. Incorporen la descripción del sistema si está disponible.

Sin viñetas. Párrafo continuo y fluido.

================================================================
SECCION 2 - RESUMEN EJECUTIVO
================================================================
Redacta un único párrafo denso de 6-8 frases que:
- Sintetice el estado de madurez UX del sistema con criterio profesional.
- Mencione las fortalezas: heurísticas con mejor rendimiento:
  ${optimal.length ? optimal.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna destacable'}
- Señale las debilidades críticas que requieren intervención urgente:
  ${critical.length ? critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna'}
- Interprete qué significa el nivel global para los usuarios finales del sitio.
- Mencione los ${globalWarnings} warnings y su implicación para la fiabilidad del estudio.
- Incluya los datos de cumplimiento por evaluador para dar contexto:
${evaluatorSummary}

Sin viñetas. Párrafo continuo.

================================================================
SECCION 3 - PRIORIDAD DE MEJORA POR IMPACTO NEGATIVO
================================================================
Para CADA heurística ordenada por impacto negativo (de menor a mayor cumplimiento), redacta UN PÁRRAFO por heurística con:

${heuristicsDetailText}

Estructura de cada párrafo:
1. POR QUÉ ocupa esta posición: basado en el porcentaje de cumplimiento, la desviación típica y las puntuaciones de las preguntas concretas.
2. IMPACTO REAL en el usuario: qué experimenta, dónde se produce fricción, errores o abandono.
3. EVIDENCIA: menciona los datos concretos (porcentajes, warnings, preguntas con peor puntuación).
4. URGENCIA: basada en la severidad y la cantidad de warnings.

IMPORTANTE: Usa los datos de las preguntas individuales para ser específico. No seas genérico.

================================================================
SECCION 4 - ANALISIS DETALLADO POR HEURISTICA
================================================================
Para CADA heurística, genera un análisis con esta estructura exacta:

[NOMBRE DE LA HEURISTICA] — [XX.XX%] — Severidad: [Nivel]

Descripción funcional: (1-2 frases) Qué evalúa esta heurística y por qué es relevante para este sistema concreto.

Evaluación de criterios: Basándote en las puntuaciones de cada pregunta, identifica qué criterios concretos funcionan bien y cuáles fallan. Menciona las medias obtenidas.

Estado actual: (3-4 frases) Interpretación cualitativa. ¿Hay consenso entre evaluadores (desviación típica baja) o divergencia (alta)? ¿Qué experimenta el usuario? ¿Qué patrones revelan las puntuaciones?

Impacto en la experiencia: (2-3 frases) Efecto concreto en el comportamiento del usuario. Menciona warnings si los hay como evidencia de fricción.

Plan de acción recomendado: (3 recomendaciones numeradas, específicas y técnicas. Nada de "mejorar la usabilidad".)

Datos disponibles para cada heurística:
${heuristicsDetailText}

================================================================
SECCION 5 - COMPARATIVA DE PUNTUACIONES POR EVALUADOR
================================================================
Redacta 5-6 frases que:

Puntuaciones individuales:
${evaluatorScoresText}

Heurísticas con mayor dispersión (desviación típica alta = menos consenso):
${JSON.stringify(highSdHeuristics, null, 2)}

Tu análisis debe:
1. Evaluar el nivel de acuerdo inter-evaluador: ¿hay consenso o divergencia?
2. Identificar las heurísticas con más dispersión y por qué podrían generar experiencias distintas.
3. Señalar si algún evaluador puntúa significativamente diferente y posibles causas.
4. Concluir sobre la validez y representatividad del estudio.
5. Si hay comentarios de evaluadores, úsalos para enriquecer el análisis.

================================================================
SECCION 6 - CONCLUSION
================================================================
Redacta 6-8 frases finales que:

Datos globales:
- Cumplimiento global: ${globalCompliance != null ? globalCompliance.toFixed(2) + '%' : 'N/D'} (${globalSeverity})
- Áreas más críticas: ${top3Critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ')}
- Total warnings: ${globalWarnings}
- Promedio de evaluadores: ${evaluatorSummary}

Tu conclusión debe:
1. Recapitular el estado general con perspectiva estratégica (no repetir números, sintetizar).
2. Destacar las 2-3 áreas de mejora más urgentes y POR QUÉ (impacto en el usuario).
3. Evaluar el potencial de mejora: si se resuelven los problemas críticos, ¿cómo mejora la experiencia?
4. Proponer un roadmap: qué atacar primero y en qué orden, con criterio de impacto vs. esfuerzo.
5. Cerrar con una valoración profesional honesta del estado del producto.

${reportItem?.finalReport ? `\nNota del equipo evaluador (úsala como contexto, no la copies): "${stripHtml(reportItem.finalReport)}"` : ''}

FIN DEL INFORME
`.trim()
}

export function buildOllamaRequestBody(
  reportItem,
  model = process.env.VUE_APP_OLLAMA_MODEL || DEFAULT_MODEL,
) {
  return {
    model,
    stream: false,
    options: {
      temperature: 0.4,
      top_p: 0.9,
      num_predict: 6000,
      repeat_penalty: 1.15,
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildHeuristicReportPrompt(reportItem) },
    ],
  }
}
