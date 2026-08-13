<template>
  <div>
    <v-col class="d-flex flex-column" style="min-height: 500px">
      <h2 class="mb-4">Configuración del Reporte Final</h2>
      <p class="text-body-2 text-grey-darken-1 mb-6">
        Selecciona qué información deseas incluir en el PDF
      </p>

      <v-card variant="outlined" class="mb-4">
        <v-card-text>
          <h3 class="text-h6 mb-4">Contenido del Reporte</h3>

          <v-checkbox
            v-model="pdfConfig.includeDescription"
            label="Descripción del test"
            density="comfortable"
            hide-details
            class="mb-2"
          />

          <v-checkbox
            v-model="pdfConfig.includeConclusion"
            label="Conclusión y observaciones finales"
            density="comfortable"
            hide-details
            class="mb-2"
          />

          <v-checkbox
            v-model="pdfConfig.includeHeuristicComments"
            label="Comments by heuristic"
            density="comfortable"
            hide-details
            class="mb-2"
          />

          <v-divider class="my-4" />

          <h3 class="text-h6 mb-4">Estadísticas y Datos</h3>

          <v-checkbox
            v-model="pdfConfig.includeGeneralStatistics"
            label="Estadísticas generales y tablas visuales"
            density="comfortable"
            hide-details
            class="mb-2"
          />

          <v-checkbox
            v-model="pdfConfig.includeStatisticsByHeuristic"
            label="Estadísticas agrupadas por heurística"
            density="comfortable"
            hide-details
            class="mb-2"
          />

          <v-divider class="my-4" />

          <h3 class="text-h6 mb-4">Respuestas de Evaluadores</h3>

          <v-checkbox
            v-model="pdfConfig.includeIndividualAnswers"
            label="Respuestas individuales de evaluadores (con comentarios e imágenes)"
            density="comfortable"
            hide-details
            class="mb-2"
          />

          <v-checkbox
            v-model="pdfConfig.includeGroupedAnswers"
            label="Respuestas agrupadas por heurística y evaluador"
            density="comfortable"
            hide-details
            class="mb-2"
          />

          <v-divider class="my-4" />

          <h3 class="text-h6 mb-4">Privacidad</h3>

          <v-checkbox
            v-model="pdfConfig.anonymizeEvaluators"
            label="Anonimizar información de evaluadores"
            density="comfortable"
            hide-details
            color="warning"
          />
        </v-card-text>
      </v-card>

      <div v-if="isLoading" class="mt-4">
        <p>
          Generating Report PDF. This operation might take a few minutes. Don't
          close this tab.
        </p>
        <v-progress-linear indeterminate class="mb-8" />
      </div>

      <div class="flex-grow-1" />

      <v-row class="ma-0" justify="space-between" align-content="end">
        <v-btn
          color="blue-grey-darken-3"
          elevation="0"
          @click="emit('return-step')"
        >
          {{ $t('buttons.previous') }}
        </v-btn>
        <div class="d-flex ga-2 align-center">
          <div class="d-flex ga-4 mr-2">
            <v-chip
              v-if="geminiHasQuota"
              :key="'gemini-' + tokenUsage.gemini.remaining"
              size="small"
              :color="tokenUsage.gemini.remaining < tokenUsage.gemini.total * 0.2 ? 'error' : tokenUsage.gemini.remaining < tokenUsage.gemini.total * 0.5 ? 'warning' : 'success'"
              variant="tonal"
              prepend-icon="mdi-robot-outline"
            >
              Gemini: {{ tokenUsage.gemini.remaining.toLocaleString() }} / {{ tokenUsage.gemini.total.toLocaleString() }}
            </v-chip>
            <v-chip
              v-if="!geminiHasQuota"
              size="small"
              color="info"
              variant="tonal"
              prepend-icon="mdi-desktop-tower"
            >
              Ollama (local)
            </v-chip>
            <v-chip
              :key="'jina-' + tokenUsage.jina.remaining"
              size="small"
              :color="tokenUsage.jina.remaining < tokenUsage.jina.total * 0.2 ? 'error' : tokenUsage.jina.remaining < tokenUsage.jina.total * 0.5 ? 'warning' : 'success'"
              variant="tonal"
              prepend-icon="mdi-web"
            >
              Jina: {{ tokenUsage.jina.remaining.toLocaleString() }} / {{ tokenUsage.jina.total.toLocaleString() }}
            </v-chip>
          </div>
          <v-btn :disabled="isLoading" color="blue-grey" @click="previewPdf">
            <span v-if="!isLoading">Vista previa sin IA</span>
            <span v-else>{{ $t('pages.finalReport.options.loading') }}</span>
          </v-btn>
          <v-btn :disabled="isLoading" color="orange" @click="previewPdfWithAi">
            <span v-if="!isLoading">Vista previa con IA</span>
            <span v-else>{{ $t('pages.finalReport.options.loading') }}</span>
          </v-btn>
        </div>
      </v-row>
    </v-col>

    <v-dialog v-model="isPreviewOpen" fullscreen>
      <v-card>
        <v-toolbar color="blue-grey-darken-3" density="comfortable">
          <v-toolbar-title>{{ previewTitle }}</v-toolbar-title>
          <v-spacer />
          <v-btn
            variant="text"
            prepend-icon="mdi-download"
            :disabled="!previewUrl"
            @click="downloadPreview"
          >
            Descargar PDF
          </v-btn>
          <v-btn icon variant="text" @click="closePreview">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>

        <v-card-text class="pa-0" style="height: calc(100vh - 64px)">
          <iframe
            v-if="previewUrl"
            :src="previewUrl"
            title="Vista previa del informe heuristico"
            style="width: 100%; height: 100%; border: 0"
          />
          <div
            v-else-if="previewError"
            class="d-flex flex-column align-center justify-center pa-8 text-center"
            style="height: 100%"
          >
            <v-icon color="red" size="48">mdi-alert-circle-outline</v-icon>
            <h3 class="mt-4">No se pudo generar la vista previa</h3>
            <p class="mt-2 text-grey-darken-1" style="max-width: 720px">
              {{ previewError }}
            </p>
          </div>
          <div
            v-else
            class="d-flex flex-column align-center justify-center"
            style="height: 100%"
          >
            <v-progress-circular
              indeterminate
              color="blue-grey-darken-3"
              size="48"
            />
            <p class="mt-4">{{ previewStatus }}</p>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onBeforeUnmount, watch } from 'vue'
import { useStore } from 'vuex'
import { useI18n } from 'vue-i18n'
import { generateHeuristicPdf } from '@/ux/Heuristic/utils/pdfGenerator'
import { generateHeuristicPdfWithAi } from '@/ux/Heuristic/utils/pdfGeneratorWithAi'
import {
  buildHeuristicsEvaluator,
  buildHeuristicsStatistics,
  finalResult,
  formatTimeSpentFromMs,
  statistics,
  standardDeviation,
} from '@/ux/Heuristic/utils/statistics'
import { buildOllamaRequestBody } from '@/ux/Heuristic/utils/aiReportPrompt'
import { STUDY_TYPES } from '@/shared/constants/methodDefinitions'
import { generateAiReportWithFallback, correctCommentsWithAI } from '@/app/services/geminiReportService'
import { getRemaining, hasQuota } from '@/app/services/tokenTracker'

const store = useStore()
const { t } = useI18n()

const emit = defineEmits(['return-step'])

const props = defineProps({
  heuristicComments: {
    type: Object,
    default: () => ({}),
  },
})

const statisticsData = ref('')
const isLoading = ref(false)
const isPreviewOpen = ref(false)
const previewUrl = ref('')
const previewFileName = ref('informe_heuristica_evaluacion.pdf')
const previewTitle = ref('Vista previa del informe')
const previewStatus = ref('Generando vista previa...')
const previewError = ref('')
const correctedHeuristicComments = ref(null)
const isCorrectingComments = ref(false)
const aiSource = ref('')
const aiSourceLabel = computed(() => {
  const labels = {
    gemini: 'Gemini AI',
    ollama: 'Ollama (local)',
    fallback: 'Texto de respaldo',
    jina: 'Jina AI',
    tinyfish: 'TinyFish',
    none: 'Sin investigación web',
  }
  return labels[aiSource.value] || ''
})

function refreshTokenUsage() {
  return {
    jina: getRemaining('jina'),
    gemini: getRemaining('gemini'),
  }
}
const tokenUsage = ref(refreshTokenUsage())

const forceRefreshTokens = () => {
  const fresh = refreshTokenUsage()
  tokenUsage.value = { ...fresh }
}
const geminiHasQuota = computed(() => hasQuota('gemini'))

// Configuración de PDF (para UI, pero NO filtra datos en buildFinalReportItem)
const pdfConfig = reactive({
  includeDescription: true,
  includeConclusion: true,
  includeHeuristicComments: true,
  includeGeneralStatistics: true,
  includeStatisticsByHeuristic: true,
  includeIndividualAnswers: true,
  includeGroupedAnswers: true,
  anonymizeEvaluators: false,
})

// Corregir comentarios con IA
const correctComments = async () => {
  if (!props.heuristicComments || Object.keys(props.heuristicComments).length === 0) {
    console.log('[FinalReportSelectionBox] No hay comentarios para corregir')
    correctedHeuristicComments.value = null
    return
  }
  
  if (correctedHeuristicComments.value) {
    console.log('[FinalReportSelectionBox] Comentarios ya corregidos anteriormente')
    return
  }
  
  isCorrectingComments.value = true
  console.log('[FinalReportSelectionBox] Corrigiendo comentarios con IA...')
  console.log('[FinalReportSelectionBox] Comentarios originales:', props.heuristicComments)
  
  try {
    // Convertir de Proxy a objeto plano
    const plainComments = JSON.parse(JSON.stringify(props.heuristicComments))
    
    // Detectar idioma (buscar palabras clave en catalán)
    const sampleText = Object.values(plainComments)
      .flatMap(h => Object.values(h))
      .filter(t => t && typeof t === 'string')
      .join(' ')
    
    const isCatalan = sampleText.includes('per') || sampleText.includes('que') || sampleText.includes('la') || sampleText.includes('el')
    const language = isCatalan ? 'ca' : 'es'
    
    console.log('[FinalReportSelectionBox] Idioma detectado:', language)
    
    const corrected = await correctCommentsWithAI(plainComments, language)
    correctedHeuristicComments.value = corrected
    console.log('[FinalReportSelectionBox] ✅ Comentarios corregidos:', corrected)
    
  } catch (error) {
    console.error('[FinalReportSelectionBox] ❌ Error corrigiendo comentarios:', error)
    correctedHeuristicComments.value = null
  } finally {
    isCorrectingComments.value = false
  }
}

const testAnswerDocument = computed(() => store.state.Answer.testAnswerDocument)

const answers = computed(() => {
  if (testAnswerDocument.value) {
    return testAnswerDocument.value.type === STUDY_TYPES.HEURISTIC
      ? Object.values(testAnswerDocument.value.heuristicAnswers)
      : Object.values(testAnswerDocument.value.taskAnswers)
  }
  return []
})

const test = computed(() => store.getters.test)

const resultEvaluator = computed(() => statistics())

const heuristicsEvaluator = computed(() =>
  buildHeuristicsEvaluator(resultEvaluator.value, test.value.testOptions),
)

const heuristicsStatistics = computed(() =>
  buildHeuristicsStatistics(heuristicsEvaluator.value),
)

const getSeverityLabel = (value) => {
  const percentage = Number.parseFloat(String(value ?? '').replace('%', ''))
  if (!Number.isFinite(percentage)) return 'Crítico'
  if (percentage >= 75) return 'Leve'
  if (percentage >= 50) return 'Moderado'
  if (percentage >= 25) return 'Grave'
  return 'Crítico'
}

const evaluatorPercentages = computed(() => {
  const resultItems = resultEvaluator.value || []
  const cooperators = test.value?.cooperators || []
  const matchedCoopIndices = new Set()
  const evaluatorCooperatorMap = new Map()

  resultItems.forEach((item, index) => {
    const coopIndex = cooperators.findIndex(
      (c) =>
        c?.userDocId === item?.userDocId ||
        c?.uid === item?.userDocId ||
        c?.id === item?.userDocId,
    )
    if (coopIndex >= 0 && !matchedCoopIndices.has(coopIndex)) {
      matchedCoopIndices.add(coopIndex)
      evaluatorCooperatorMap.set(index, cooperators[coopIndex])
    }
  })

  let nextCoopIndex = 0
  resultItems.forEach((item, index) => {
    if (evaluatorCooperatorMap.has(index)) return
    while (
      nextCoopIndex < cooperators.length &&
      matchedCoopIndices.has(nextCoopIndex)
    ) {
      nextCoopIndex++
    }
    const coop =
      nextCoopIndex < cooperators.length ? cooperators[nextCoopIndex] : null
    if (coop) {
      matchedCoopIndices.add(nextCoopIndex)
      evaluatorCooperatorMap.set(index, coop)
      nextCoopIndex++
    }
  })

  const items = resultItems.map((item, index) => {
    const percentage = Number.parseFloat(item?.result || '0')
    const safePercentage = Number.isFinite(percentage) ? percentage : 0
    const cooperator = evaluatorCooperatorMap.get(index)

    const name =
      cooperator?.fullName ||
      cooperator?.name ||
      cooperator?.displayName ||
      cooperator?.email ||
      item?.userDocId ||
      `Ev${index + 1}`

    return {
      name,
      email: cooperator?.email || item?.email || '',
      percentage: safePercentage.toFixed(2),
      severity: getSeverityLabel(safePercentage),
    }
  })

  const validPercentages = items
    .map((item) => Number.parseFloat(item.percentage))
    .filter((value) => Number.isFinite(value))
  const globalAverage = validPercentages.length
    ? (
        validPercentages.reduce((sum, value) => sum + value, 0) /
        validPercentages.length
      ).toFixed(2)
    : '0.00'

  return { items, globalAverage }
})

const timeByHeuristics = computed(() => {
  const table = {
    header: [{ title: 'HEURISTICS', align: 'start', value: 'heuristic' }],
    items: [],
  }

  if (!Array.isArray(resultEvaluator.value) || !resultEvaluator.value.length) {
    return table
  }

  const rowsByHeuristic = {}
  const timesByHeuristic = {}

  resultEvaluator.value.forEach((evaluator, evaluatorPosition) => {
    const evaluatorKey = `Ev${evaluatorPosition + 1}`
    table.header.push({
      title: `Evaluator ${evaluatorPosition + 1}`,
      value: evaluatorKey,
      align: 'center',
    })

    if (!Array.isArray(evaluator.heuristics)) return

    evaluator.heuristics.forEach((heuristic) => {
      const heuristicId = heuristic.id
      const timeMs = Number(heuristic.timeSpentMs || 0)

      if (!rowsByHeuristic[heuristicId]) {
        rowsByHeuristic[heuristicId] = { heuristic: heuristicId }
        timesByHeuristic[heuristicId] = []
      }

      rowsByHeuristic[heuristicId][evaluatorKey] = formatTimeSpentFromMs(timeMs)
      timesByHeuristic[heuristicId].push(timeMs)
    })
  })

  table.header.push({
    title: 'Total time',
    value: 'totalTime',
    align: 'center',
  })
  table.header.push({
    title: 'Average time per evaluator',
    value: 'averageTime',
    align: 'center',
  })

  table.items = Object.values(rowsByHeuristic).map((row) => {
    const times = timesByHeuristic[row.heuristic] || []
    const totalMs = times.reduce((acc, value) => acc + value, 0)
    const averageMs = times.length ? totalMs / times.length : 0

    return {
      ...row,
      totalTime: formatTimeSpentFromMs(totalMs),
      averageTime: formatTimeSpentFromMs(averageMs),
      timeSd: formatTimeSpentFromMs(
        times.length ? standardDeviation(times) : 0,
      ),
    }
  })

  return table
})

const getCooperatorEmails = () => {
  const cooperators = test.value.cooperators || []
  if (pdfConfig.anonymizeEvaluators) return []
  return cooperators.filter((coop) => coop?.email).map((coop) => coop.email)
}

const getTestUrl = () =>
  test.value?.websiteUrl ||
  test.value?.siteURL ||
  test.value?.url ||
  test.value?.testUrl ||
  ''

const buildFallbackConclusion = () => {
  const rankingItems = [...(heuristicsStatistics.value?.items || [])]
    .map((item) => ({
      ...item,
      percentage: Number.parseFloat(item.percentage || '0'),
    }))
    .sort((left, right) => left.percentage - right.percentage)

  const weakestHeuristics = rankingItems.slice(0, 2)

  if (!rankingItems.length) {
    return test.value.studyConclusion || ''
  }

  const globalAverage = Number.parseFloat(
    statisticsData.value?.average ||
      evaluatorPercentages.value?.globalAverage ||
      0,
  )
  const normalizedAverage = Number.isFinite(globalAverage)
    ? globalAverage.toFixed(2)
    : '0.00'
  const weakestText = weakestHeuristics
    .map(
      (item) =>
        `${item.name} (${Number.isFinite(item.percentage) ? item.percentage.toFixed(2) : '0.00'}%)`,
    )
    .join(' y ')

  return [
    `El sistema presenta un cumplimiento global del ${normalizedAverage}%, con un nivel de severidad ${getSeverityLabel(normalizedAverage)}.`,
    weakestText
      ? `Las principales oportunidades de mejora se concentran en ${weakestText}, por lo que conviene priorizar estas heurísticas en la siguiente iteración de diseño.`
      : '',
    'La mejora de estos puntos permitiría reforzar la consistencia, reducir la fricción de uso y consolidar una experiencia más estable para los distintos perfiles de evaluación.',
  ]
    .filter(Boolean)
    .join(' ')
}

const processAnswers = (answersArray) => {
  if (!pdfConfig.anonymizeEvaluators) return answersArray
  return answersArray.map((answer, index) => ({
    ...answer,
    evaluatorName: `Evaluador ${index + 1}`,
    evaluatorEmail: null,
  }))
}

// ============================================================================
  // FUNCIÓN HÍBRIDA: buildFinalReportItem
  // - Mantiene la interfaz de checkboxes para el usuario
  // - Pero SIEMPRE incluye todos los datos (como en la versión recuperada)
  // - Añade logs detallados (como en la versión recuperada)
  // ============================================================================
  const buildFinalReportItem = () => {
    statisticsData.value = finalResult(resultEvaluator.value)
    const heuristicRankingItems = [...(heuristicsStatistics.value?.items || [])]
      .map((item) => ({
        ...item,
        percentage: Number.parseFloat(item.percentage || '0'),
      }))
      .sort((left, right) => left.percentage - right.percentage)
      .map((item, index) => ({
        position: index + 1,
        name: item.name,
        percentage: item.percentage,
        severity: getSeverityLabel(item.percentage),
      }))

    const testTitle = test.value.testTitle || test.value.title || ''
    const testDescription = test.value.testDescription || test.value.description || ''

    const reportItem = {
      testTitle,
      title: testTitle,
      testUrl: getTestUrl(),
      creationDate: test.value.creationDate,
      testDescription,
      cooperatorsEmail: getCooperatorEmails(),
      creatorEmail: pdfConfig.anonymizeEvaluators
        ? null
        : test.value.testAdmin?.email || '',
      finalReport: test.value.studyConclusion || buildFallbackConclusion(),
      studyConclusion: test.value.studyConclusion || buildFallbackConclusion(),
      allOptions: test.value.testOptions,
      // SIEMPRE incluir respuestas (versión recuperada)
      allAnswers: processAnswers(answers.value),
      finalResult: statisticsData.value,
      finalResultData: statisticsData.value,
      taskAnswers: processAnswers(Object.values(testAnswerDocument.value?.taskAnswers || {})),
      testStructure: test.value.testStructure,
      // SIEMPRE incluir estadísticas (versión recuperada)
      statisticsByEvaluatorAnswer: heuristicsEvaluator.value,
      heuristicsEvaluator: heuristicsEvaluator.value,
      statisticsByHeuristics: heuristicsStatistics.value,
      heuristicsStatistics: heuristicsStatistics.value,
      timeByHeuristics: timeByHeuristics.value,
      generalStatistics: statisticsData.value,
      statisticsTable: store.state.Answer.evaluatorStatistics,
      evaluatorTimeItems: store.state.Answer.evaluatorStatistics?.items || [],
      type: testAnswerDocument.value?.type || STUDY_TYPES.HEURISTIC,
      // SIEMPRE incluir comentarios (usar corregidos si disponibles)
      heuristicComments: correctedHeuristicComments.value || props.heuristicComments,
      // Log para verificar comentarios
      _commentDebug: (() => {
        const commentsToUse = correctedHeuristicComments.value || props.heuristicComments
        console.log('[buildFinalReportItem] 🎯 heuristicComments a incluir:', commentsToUse)
        console.log('[buildFinalReportItem] 📊 Número de heurísticas con comentarios:', 
          Object.keys(commentsToUse || {}).length)
        console.log('[buildFinalReportItem] ⚡ Usando comentarios:', correctedHeuristicComments.value ? 'CORREGIDOS' : 'ORIGINALES')
        return null
      })(),
      evaluatorPercentages: evaluatorPercentages.value,
      heuristicRanking: {
        items: heuristicRankingItems,
      },
      participants: getCooperatorEmails().map((email) => ({ email })),
      anonymized: pdfConfig.anonymizeEvaluators,
    }

    // Logs detallados (versión recuperada)
    console.log('[FinalReportItem] 📦 Datos preparados para IA:', {
      titulo: reportItem.title,
      url: reportItem.testUrl,
      descripcion: reportItem.testDescription?.substring(0, 100),
      numHeuristicas: reportItem.statisticsByHeuristics?.items?.length || 0,
      numEvaluadores: reportItem.statisticsTable?.items?.length || 0,
      numRespuestas: reportItem.allAnswers?.length || 0,
      numEstructuras: reportItem.testStructure?.length || 0,
      cumplimientoGlobal: reportItem.generalStatistics?.average,
      tieneComentarios: Object.keys(reportItem.heuristicComments || {}).length > 0,
      rankingHeuristicas: heuristicRankingItems.map(h => `${h.name}: ${h.percentage}%`),
    })

    return reportItem
  }

// ============================================================================
// FUNCIÓN: generateAiFinalReport (con logs detallados de la versión recuperada)
// ============================================================================
const generateAiFinalReport = async (finalReportItem) => {
  console.log('[generateAiFinalReport] 🎯 Iniciando generación de informe con IA...')

  const tokenInterval = setInterval(() => {
    forceRefreshTokens()
  }, 1500)

  try {
    const result = await generateAiReportWithFallback(finalReportItem, {
      ollamaUrl: process.env.VUE_APP_OLLAMA_API_URL || 'http://localhost:11434/api/chat',
      buildFallback: buildFallbackConclusion
    })

    const content = typeof result === 'string' ? result : result.content
    const webResearch = typeof result === 'string' ? '' : (result.webResearch || '')
    const source = typeof result === 'string' ? '' : (result.source || '')

    if (source) {
      aiSource.value = source
      console.log('[generateAiFinalReport] 🔌 Fuente:', source)
    }

    forceRefreshTokens()

    if (webResearch) {
      finalReportItem.webResearch = webResearch
    }

    clearInterval(tokenInterval)
    return { content, webResearch, source, sections: result.sections || null }
    
  } catch (error) {
    console.error('[generateAiFinalReport] ❌ Error generando informe con IA:', error)
    clearInterval(tokenInterval)
    return finalReportItem.finalReport || buildFallbackConclusion()
  }
}

const slugify = (text) =>
  text
    ?.toString()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\-]+/g, '')

const buildPreviewFileName = (suffix = '') => {
  const title = slugify(test.value.testTitle || test.value.title || 'report')
  const creationDate = slugify(
    test.value.creationDate || new Date().toISOString(),
  )
  return `final_report${suffix}_${title}_${creationDate}.pdf`
}

const revokePreviewUrl = () => {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

const startPreview = (title, status) => {
  revokePreviewUrl()
  previewTitle.value = title
  previewStatus.value = status
  previewError.value = ''
  isPreviewOpen.value = true
}

const showPreviewError = (error, fallbackMessage) => {
  previewError.value = error?.message || fallbackMessage
}

const closePreview = () => {
  isPreviewOpen.value = false
  revokePreviewUrl()
}

const downloadPreview = () => {
  if (!previewUrl.value) return
  const link = Object.assign(document.createElement('a'), {
    href: previewUrl.value,
    download: previewFileName.value,
  })
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const openPdfPreview = async (
  finalReportItem,
  suffix = '',
  extraOptions = {},
  generator = generateHeuristicPdf,
) => {
  previewStatus.value = 'Construyendo PDF...'
  const previewResult = await generator(finalReportItem, {
    mode: 'preview',
    ...extraOptions,
  })

  previewUrl.value = previewResult?.url || ''
  previewFileName.value = suffix
    ? buildPreviewFileName(suffix)
    : previewResult?.fileName || buildPreviewFileName()

  if (!previewUrl.value) {
    throw new Error('El generador no ha devuelto una URL de previsualizacion.')
  }
}

const previewPdf = async () => {
  isLoading.value = true
  forceRefreshTokens()
  
  await correctComments()
  
  startPreview('Vista previa del informe sin IA', 'Construyendo PDF...')
  try {
    const reportItem = buildFinalReportItem()
    await openPdfPreview(reportItem, '', {
      showQuickSummary: false,
    })
  } catch (error) {
    console.error('[previewPdf] ❌ Error:', error)
    showPreviewError(error, 'No se pudo generar la vista previa. Verifica que el test tenga datos de evaluación.')
  } finally {
    isLoading.value = false
    forceRefreshTokens()
  }
}

const previewPdfWithAi = async () => {
  isLoading.value = true
  aiSource.value = ''
  forceRefreshTokens()
  
  await correctComments()
  
  startPreview(
    'Vista previa del informe con IA',
    'Generando informe con IA...',
  )
  try {
    const finalReportItem = buildFinalReportItem()
    const aiResult = await generateAiFinalReport(finalReportItem)
    const aiContent = typeof aiResult === 'string' ? aiResult : aiResult.content
    const aiSections = typeof aiResult === 'string' ? null : aiResult.sections

    finalReportItem.finalReport = aiContent
    finalReportItem.studyConclusion = aiContent

    // Distribuir secciones parseadas
    if (aiSections) {
      finalReportItem.aiSections = aiSections
      finalReportItem.aiIntroduccion = aiSections.introduccion || ''
      finalReportItem.aiPorcentajes = aiSections.porcentajes || ''
      finalReportItem.aiTiposRespuesta = aiSections.tipos_respuesta || ''
      finalReportItem.aiHeuristicasPrioritarias = aiSections.heuristicas_prioritarias || ''
      finalReportItem.aiAnalisisHeuristico = aiSections.analisis_heuristico || ''
      finalReportItem.aiComparativa = aiSections.comparativa || ''
      finalReportItem.aiConclusion = aiSections.conclusion || ''
    }

    const sourceLabel = aiSourceLabel.value
    previewTitle.value = sourceLabel
      ? `Vista previa del informe con IA (${sourceLabel})`
      : 'Vista previa del informe con IA'

    await openPdfPreview(finalReportItem, '_ai', { showQuickSummary: false }, generateHeuristicPdfWithAi)
  } catch (error) {
    console.error('[previewPdfWithAi] ❌ Error generando PDF con IA:', error)
    previewStatus.value =
      'La IA no está disponible. Generando vista previa con datos del test...'

    try {
      const fallbackItem = buildFinalReportItem()
      fallbackItem.finalReport = buildFallbackConclusion()
      fallbackItem.studyConclusion = fallbackItem.finalReport
      previewTitle.value = 'Vista previa del informe (sin IA)'
      await openPdfPreview(fallbackItem, '_ai_fallback', {
        showQuickSummary: false,
      }, generateHeuristicPdf)
    } catch (fallbackError) {
      showPreviewError(
        fallbackError,
        'No se pudo generar la vista previa. Verifica que el test tenga datos de evaluación.',
      )
    }
  } finally {
    isLoading.value = false
    forceRefreshTokens()
  }
}

onBeforeUnmount(() => {
  revokePreviewUrl()
})

watch(isPreviewOpen, (value) => {
  if (!value) revokePreviewUrl()
})
</script>

<style scoped>
.titleView {
  font-style: normal;
  font-weight: 300;
  font-size: 60px;
  line-height: 70px;
  display: flex;
  align-items: center;
  color: #000000;
}

.subtitleView {
  font-style: normal;
  font-weight: 200;
  font-size: 18.1818px;
  align-items: flex-end;
  color: #000000;
  margin-bottom: 4px;
  padding-bottom: 2px;
}

.scroll {
  overflow-y: auto;
  overflow-x: hidden;
}

.cardStyle {
  background-color: transparent;
  border: 0.2px solid rgba(0, 0, 0, 0.25);
}

.tab-text {
  font-style: normal;
  font-weight: 200;
  font-size: 18.1818px;
  align-items: center;
  color: #000000;
}

.list-scroll {
  height: 508px;
  overflow: auto;
}

/* Nav bar list scroll bar */
/* width */
.list-scroll::-webkit-scrollbar {
  width: 7px;
}

/* Track */
.list-scroll::-webkit-scrollbar-track {
  background: none;
}

/* Handle */
.list-scroll::-webkit-scrollbar-thumb {
  background: #ffcd86;
  border-radius: 4px;
}

/* Handle on hover */
.list-scroll::-webkit-scrollbar-thumb:hover {
  background: #fca326;
}

.weightsStatisticsStyle {
  border-radius: 20px;
  border: 0.2px solid #fca326;
  width: 950px;
}

.radar {
  background: #fff;
}

.if-card {
  border-radius: 15px;
  border: 0.2px solid #fca326;
  width: 970px;
  font-size: 18px;
}

.v-chip {
  min-width: 50px;
  justify-content: center;
}
</style>
