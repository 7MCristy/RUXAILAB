/**
 * Construcción del prompt/plan de llamadas para Ollama/Qwen. El parseo y
 * ensamblaje de lo que Ollama responde vive en ollamaResponseParser.js —
 * aquí solo queda la REDACCIÓN de lo que se le pide, afinada para un
 * modelo local más pequeño que Gemini (de ahí llamadas más cortas, en
 * varios lotes, con instrucciones anti-repetición más insistentes).
 */

import { OLLAMA_MODEL } from '@/shared/constants/models'
import { SYSTEM_PROMPT } from './aiReportPrompt'
import { sectionMarker, prepareReportData } from './promptDataHelpers'

const HEURISTICS_PER_BATCH = 4

const OLLAMA_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

NORMAS ADICIONALES PARA ANÁLISIS CUANTITATIVO:
- Basa el análisis en la media del grupo de evaluadores (tendencia central), no en un único evaluador.
- Si el máximo o el mínimo de una heurística se aleja de la media más de una desviación típica (SD), trátalo como "voto discrepante": menciónalo como aparte, no lo uses para caracterizar la heurística en general.
- Si un comentario contradice claramente el consenso (elogio cuando el resto reporta problemas graves, o al revés), trátalo como comentario atípico, no como opinión mayoritaria.
- Si la SD de una heurística es mayor a 0.5, indica que la experiencia puede variar según el perfil o contexto del usuario.
- Redondea las cifras que menciones a 1 decimal.
- NO uses relleno. Cada frase debe aportar información concreta y valor analítico.
- NO repitas la misma frase, idea o lista dos veces dentro de una misma respuesta. Escribe cada idea una única vez y avanza.
- NO generes contenido genérico basado en tu conocimiento previo de las heurísticas de usabilidad: usa EXCLUSIVAMENTE los datos numéricos y cualitativos concretos que se te proporcionan en el prompt.`.trim()

export function buildOllamaPlan(
  reportItem,
  model = process.env.VUE_APP_OLLAMA_MODEL || OLLAMA_MODEL,
  webResearchContent = '',
) {
  const d = prepareReportData(reportItem, webResearchContent, {
    condensed: false,
  })
  const promptText = promptIntroPorcentajes(d)
  const promptTextConclusion = promptConclusion(d)
  console.log('[Ollama] Plan:', {
    testName: d.testName,
    model,
    totalHeuristicas: d.heuristics.length,
    optimas: d.optimal.length,
    criticas: d.critical.length,
    lotes: Math.ceil(d.heuristics.length / HEURISTICS_PER_BATCH),
    tieneWebResearch: Boolean(webResearchContent),
    contextWindow: 14336,
    estimatedPromptChars: {
      intro: promptText.length,
      conclusion: promptTextConclusion.length,
    },
    estimatedPromptTokens: {
      intro: Math.ceil(promptText.length / 3.5),
      conclusion: Math.ceil(promptTextConclusion.length / 3.5),
    },
    preview: {
      intro: promptText.slice(0, 200),
      conclusion: promptTextConclusion.slice(0, 200),
    },
  })
  const calls = []
  // Petición 1: Introducción + Porcentajes combinadas en una sola llamada
  calls.push({
    key: 'intro_porcentajes',
    requestBody: {
      model,
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.9,
        num_ctx: 14336,
        num_predict: 6000,
        num_thread: 4,
        repeat_penalty: 1.2,
        repeat_last_n: 256,
      },
      messages: [
        { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
        { role: 'user', content: promptIntroPorcentajes(d) },
      ],
    },
  })
  // Petición(es): análisis heurístico por lotes (una llamada por lote)
  const batchTexts = batches(d)
  batchTexts.forEach((batch, i) => {
    calls.push({
      key: `analisis_lote_${i + 1}`,
      requestBody: {
        model,
        stream: false,
        options: {
          temperature: 0.25,
          top_p: 0.9,
          num_ctx: 12288,
          num_predict: 8800,
          num_thread: 4,
          repeat_penalty: 1.3,
          repeat_last_n: 256,
        },
        messages: [
          { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
          { role: 'user', content: batch },
        ],
      },
    })
  })
  // Petición final: Conclusión (funde comparativa dentro de la conclusión para
  // Ollama; incluye la investigación web ya obtenida)
  calls.push({
    key: 'conclusion',
    requestBody: {
      model,
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.9,
        num_ctx: 12288,
        num_predict: 4000,
        num_thread: 4,
        repeat_penalty: 1.2,
        repeat_last_n: 256,
      },
      messages: [
        { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
        { role: 'user', content: promptConclusion(d) },
      ],
    },
  })
  return {
    calls,
    meta: {
      testName: d.testName,
      globalCompliance: d.globalCompliance,
      globalSeverity: d.globalSeverity,
      totalHeuristics: d.heuristics.length,
      totalBatches: Math.ceil(d.heuristics.length / HEURISTICS_PER_BATCH),
      hasWebResearch: Boolean(webResearchContent),
      sortedByImpact: d.sortedByImpact,
    },
  }
}

/**
 * Petición combinada: Introducción + Porcentajes en una sola llamada a Qwen.
 * Se le pide a Qwen que marque cada sección con su encabezado markdown
 * (## Introducción / ## Porcentajes, vía sectionMarker reutilizado de
 * promptDataHelpers.js) para poder separarlas después con assembleOllamaReport().
 */
function promptIntroPorcentajes(d) {
  const webContext = d.webResearchContent
    ? `\nContexto adicional obtenido mediante investigación web sobre el sitio evaluado (intégralo brevemente en la introducción solo si aporta valor real para situar el sistema; no lo copies textualmente ni lo cites como fuente externa):\n${d.webResearchContent}\n`
    : ''
  return `DATOS DEL SISTEMA EVALUADO:
- Nombre: ${d.testName}
- URL: ${d.testUrl || 'No especificada'}
- Descripción: ${d.testDescription || 'No disponible'}
- Cumplimiento global: ${d.globalCompliance != null ? d.globalCompliance.toFixed(2) + '%' : 'N/D'}
- Severidad global: ${d.globalSeverity}
- Total de warnings: ${d.globalWarnings}
- Evaluadores: ${d.evaluatorItems.length}${d.methodologyText ? `\n- Metodología: ${d.methodologyText}` : ''}

ESTRUCTURA DE HEURÍSTICAS Y PREGUNTAS:
${d.testStructureText}

PUNTUACIONES POR EVALUADOR:
${d.evaluatorSummary}

HEURÍSTICAS POR RENDIMIENTO:
- Óptimas (>=90%): ${d.optimal.length ? d.optimal.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna destacable'}
- Críticas (<75%): ${d.critical.length ? d.critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna'}
- Intermedias (75-89%): ${d.warning.length ? d.warning.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ') : 'Ninguna'}
${webContext}
INSTRUCCIONES PARA ANÁLISIS CUALITATIVO:
- Outliers: si algún evaluador puntúa más de 1 desviación típica por encima o por debajo de la media, consíderalo un "voto discrepante". Menciónalo pero NO lo incluyas en el análisis principal de tendencia.
- Comentarios atípicos: si un comentario se desvía significativamente del consenso, menciónalo separadamente como comentario atípico.
- Base tu análisis principalmente en la tendencia central (media) y en el consenso entre la mayoría de evaluadores.
- Si hay alta dispersión (desviación típica > 0.5), señala que la experiencia puede variar según el perfil del usuario.

Vas a redactar DOS secciones dentro de esta misma respuesta. Cada sección debe empezar EXACTAMENTE en su propia línea con el encabezado markdown indicado (dos almohadillas seguidas del título, tal cual), sin numerarlo ni modificarlo, y sin añadir ningún otro encabezado o subtítulo.

OBLIGATORIO: la sección Introducción NUNCA puede quedar vacía ni casi vacía. Escribe sus 5-7 párrafos completos justo debajo de su encabezado, ANTES de escribir el encabezado de Porcentajes. No dejes contenido de la introducción para después del encabezado de Porcentajes.

${sectionMarker('INTRODUCCION', 'markdown')}
Redacta 5-7 párrafos en prosa continua y tono formal que organicen la siguiente información sin presentar aún resultados, porcentajes ni recomendaciones, y de dos lineas cada uno:

1. Presenta la organización, empresa o proyecto y su ámbito de actuación.
2. Explica el problema o necesidad que pretende resolver el sistema.
3. Describe la solución y sus principales componentes tecnológicos.
4. Menciona el contexto institucional, empresarial o de investigación.
5. Explica el propósito de la evaluación heurística.
6. Identifica a los usuarios principales y los objetivos del estudio.
${d.webResearchContent ? '7. Si aporta contexto real, integra brevemente la información de investigación web sobre el sitio, sin citarla como fuente externa ni copiarla textualmente.' : ''}

Utiliza únicamente la información proporcionada. No presentes todavía resultados, porcentajes ni recomendaciones. Escribe en prosa continua, con un tono formal y claro. Debajo del encabezado escribe solo el texto de los párrafos, sin repetir el título ni añadir subtítulos.

${sectionMarker('PORCENTAJES', 'markdown')}
Redacta un ÚNICO párrafo denso de 6-8 frases (nunca una lista ni una enumeración) que:
- Sintetice el estado de madurez UX del sistema con criterio profesional.
- Presente el porcentaje global de cumplimiento y su nivel de severidad.
- Mencione, como máximo, 2-3 fortalezas concretas (heurísticas con mejor rendimiento) sin enumerar las 15 heurísticas.
- Señale, como máximo, 2-3 debilidades críticas que requieren intervención urgente, sin enumerar las 15 heurísticas.
- Interprete qué significa el nivel global para los usuarios finales del sitio.
- Mencione los ${d.globalWarnings} warnings y su implicación para la fiabilidad del estudio.
- Incluya los datos de cumplimiento por evaluador para dar contexto.

PROHIBIDO: no listes ni numeres las 15 heurísticas una por una (ese desglose completo ya se hace en otra sección). Sin viñetas, sin numeración, un único párrafo continuo. Debajo del encabezado escribe solo el párrafo, sin repetir el título ni añadir subtítulos, y no lo repitas dos veces.`
}

function batches(d) {
  const result = []
  const sorted = d.sortedByImpact
  for (let i = 0; i < sorted.length; i += HEURISTICS_PER_BATCH) {
    const slice = sorted.slice(i, i + HEURISTICS_PER_BATCH)
    const heuristicsText = slice
      .map((h) => {
        const imageLine = h.imageSummary
          ? `  Evidencias visuales: ${h.imageSummary}`
          : ''
        const commentsBlock =
          h.allComments && h.allComments.length > 0
            ? `  Comentarios de evaluadores:\n${h.allComments.map((c) => `    - [${c.evaluator}] Q${c.questionIndex}: "${c.text}"`).join('\n')}`
            : `  Comentarios de evaluadores: ${h.manualComment ? `"${h.manualComment}"` : 'Sin comentarios'}`
        return `--- Heurística H${h.position} ---
  Título: ${h.title}
  Severidad: ${h.severity}
  Cumplimiento: ${h.compliance != null ? h.compliance.toFixed(1) + '%' : 'N/D'}
  Desviación típica: ${h.standardDeviation != null ? h.standardDeviation.toFixed(2) : 'N/D'}
  Rango de puntuaciones: ${h.min != null ? h.min.toFixed(2) : 'N/D'} - ${h.max != null ? h.max.toFixed(2) : 'N/D'}
  Media: ${h.average != null ? h.average.toFixed(2) : 'N/D'} | Media de medias por pregunta: ${h.questionAverageMean != null ? h.questionAverageMean.toFixed(2) : 'N/D'} (${h.questionAverageMeanPercentage != null ? h.questionAverageMeanPercentage.toFixed(1) + '%' : 'N/D'})
  Evaluadores que participaron: ${h.evaluatorCount ?? 'N/D'}
  Warnings: ${h.warnings}
  Preguntas:
${h.questionSummary}
${imageLine}
${commentsBlock}`
      })
      .join('\n\n')
    const webContext = d.webResearchContent
      ? `\nContexto web (integra solo si aporta a hallazgos o recomendaciones):\n${d.webResearchContent}\n`
      : ''
    result.push(`Eres un consultor senior de UX. Analiza cada heurística aplicando estrictamente las reglas del system prompt.

DATOS A ANALIZAR: exactamente ${slice.length} heurísticas, indicadas más abajo con su código H{numero} real. Analiza SOLO esas ${slice.length}, ni una más ni una menos. No inventes ni añadas heurísticas que no estén en la lista de datos, aunque las reconozcas de las 15 heurísticas estándar de Nielsen + Tognazzini: usa EXCLUSIVAMENTE los porcentajes, comentarios y preguntas concretos que se te dan abajo, no tu conocimiento genérico sobre esas heurísticas.

RESTRICCIÓN DE EXTENSIÓN:
- Analiza en DETALLE (con los 4 bloques) todas las heurísticas con severidad CRÍTICA, GRAVE o MODERADA (cumplimiento < 90%).
- Las heurísticas con severidad LEVE (cumplimiento >= 90%) TAMBIÉN deben llevar su propio encabezado H{numero} y los 4 bloques con sus etiquetas — NUNCA las omitas ni las agrupes en un párrafo aparte — pero cada bloque contiene SOLO 1 frase breve en vez de 2-3. TODAS las heurísticas del lote, sin excepción, deben aparecer con este esquema H{numero}/[ETIQUETA]...[/ETIQUETA].
- Sé breve: cada bloque tiene el límite de frases indicado abajo. No lo superes ni repitas la misma idea con otras palabras dentro del mismo bloque.

CRITERIOS DE SEVERIDAD:
- CRÍTICA: cumplimiento < 50% → Análisis completo con 4 bloques
- GRAVE: cumplimiento 50-74% → Análisis completo con 4 bloques
- MODERADA: cumplimiento 75-89% → Análisis completo con 4 bloques
- LEVE: cumplimiento >= 90% → Los mismos 4 bloques con etiquetas, 1 frase c/u

INSTRUCCIÓN DE FORMATO OBLIGATORIA:
Escribe CADA análisis de heurística usando EXACTAMENTE este esquema. NO copies las etiquetas entre corchetes ni los indicadores de longitud entre paréntesis, solo escribe el contenido:

H{numero}
[ESTADO_ACTUAL]
Máximo 2 frases interpretando el estado cualitativo.
[/ESTADO_ACTUAL]
[IMPACTO_NEGATIVO]
Máximo 2 frases con el efecto negativo concreto en el usuario, considerando el porcentaje de cumplimiento y la media de respuestas. Si hay información web, integra cómo afecta a usuarios reales.
[/IMPACTO_NEGATIVO]
[PROPUESTAS_DE_MEJORA]
Máximo 2 recomendaciones específicas y técnicas en infinitivo, en frases cortas. Basándote en comentarios de evaluadores y, si está disponible, en la investigación web.
[/PROPUESTAS_DE_MEJORA]
[RESUMEN_EJECUTIVO]
Exactamente 1 frase resumen para el equipo de desarrollo.
[/RESUMEN_EJECUTIVO]

REGLAS DE FORMATO:
- Solo escribe el contenido analítico directamente dentro de cada bloque.
- Cada bloque DEBE cerrarse con la etiqueta de cierre [/ETIQUETA].
- Separa cada heurística con una línea en blanco.
- Escribe cada heurística UNA SOLA VEZ. No repitas ninguna heurística ni generes la lista completa dos veces en la misma respuesta.

IMPORTANTE:
- Cada heurística DEBE empezar con su encabezado: H{numero}
- {numero} = el H{n} FIJO de esa heurística en los datos, NO un correlativo según el orden de análisis.
- Analiza en el orden dado abajo (menor a mayor cumplimiento), pero mantén el {numero} original.

Datos disponibles para cada heurística (analiza SOLO estas ${slice.length}):
${heuristicsText}
${webContext}
No incluyas títulos de sección ni numeración de párrafos, solo los bloques por heurística. No repitas contenido ya escrito en esta misma respuesta.`)
  }
  return result
}

function promptConclusion(d) {
  const web = d.webResearchContent
    ? `\nContexto web (integra solo si aporta a hallazgos o roadmap):\n${d.webResearchContent}\n`
    : ''
  return `Datos globales:
- Cumplimiento global: ${d.globalCompliance != null ? d.globalCompliance.toFixed(2) + '%' : 'N/D'} (${d.globalSeverity})
- Áreas más críticas: ${d.top3Critical.map((h) => `${h.title} (${h.compliance?.toFixed(1)}%)`).join(', ')}
- Total warnings: ${d.globalWarnings}
- Promedio de evaluadores: ${d.evaluatorSummary}
${web}
Redacta la conclusión final en 8-12 frases, sin viñetas ni números, narrativa continua y profesional exactamente en este orden:

1. Síntesis: Estado global cualitativo del sistema con el ${d.globalCompliance != null ? d.globalCompliance.toFixed(2) + '%' : 'N/D'} de cumplimiento y gravedad ${d.globalSeverity}.
2. Hallazgos: 2-3 áreas críticas (${d.top3Critical.map((h) => h.title).join(', ')}) y por qué impactan directamente a la experiencia del usuario al completar tareas o comprender la interfaz.
3. Potencial: Cómo mejorarían la experiencia del usuario y la usabilidad general si se resolven estas áreas críticas.
4. Roadmap: Priorización "impacto vs. esfuerzo" - primero qué problema crítico de alta relevancia se abordará y después qué mejoras de mediano esfuerzo complementan la solución.
5. Cierre: Valoración profesional honesta del estado actual y perspectivas a corto plazo.

No uses viñetas ni números. Narrativa continua y profesional. Exactamente 8-12 frases.`
}
