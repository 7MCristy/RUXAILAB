<template>
  <div>
    <v-col class="d-flex flex-column" style="min-height: 500px">
      <!-- Título no topo -->
      <h2>Final Report Content</h2>

      <!-- Lista de conteúdo do relatório -->
      <ul class="mt-4" style="padding-left: 1.2rem; line-height: 1.6">
        <li>Test description</li>
        <li>Conclusion and final observations</li>
        <li>General test data and metadata</li>
        <li>Results with statistics and visual tables</li>
        <li>All evaluator answers with optional comments and images</li>
        <li>Grouped answers by heuristic and evaluator</li>
        <li>Formatted layout for presentation</li>
        <li>Downloadable PDF document</li>
      </ul>

      <div v-if="isLoading" class="mt-12">
        <p>
          Generating Report PDF. This operation might take a few minutes. Don't
          close this tab.
        </p>
        <v-progress-linear indeterminate />
      </div>

      <!-- Espaço expansível entre o título e os botões -->
      <div class="flex-grow-1" />

      <v-row class="ma-0" justify="space-between" align-content="end">
        <v-btn
          color="blue-grey-darken-3"
          elevation="0"
          @click="emit('return-step')"
        >
          {{ $t('buttons.previous') }}
        </v-btn>
        <div class="d-flex ga-2">
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
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { useStore } from 'vuex'
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
import { generateAiReportWithFallback } from '@/app/services/geminiReportService'
// Vuex store
const store = useStore()

// Vue I18n
// Emits
const emit = defineEmits(['return-step'])

// Props
const props = defineProps({
  heuristicComments: {
    type: Object,
    default: () => ({}),
  },
})

// Reactive state
const statisticsData = ref('')
const isLoading = ref(false)
const isPreviewOpen = ref(false)
const previewUrl = ref('')
const previewFileName = ref('informe_heuristica_evaluacion.pdf')
const previewTitle = ref('Vista previa del informe')
const previewStatus = ref('Generando vista previa...')
const previewError = ref('')

// Computed properties
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

// Statistics Results
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

const generateAiFinalReport = async (finalReportItem) => {
  try {
    // Intenta Gemini primero, fallback a Ollama si está disponible
    const content = await generateAiReportWithFallback(finalReportItem, {
      ollamaUrl: process.env.VUE_APP_OLLAMA_API_URL || 'http://localhost:11434/api/chat',
      buildFallback: buildFallbackConclusion
    })
    return content
  } catch (error) {
    console.error('AI report generation error:', error)
    // Fallback final: conclusión manual
    return finalReportItem.finalReport || buildFallbackConclusion()
  }
}

const getCooperatorEmails = () => {
  const cooperators = test.value.cooperators || []
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

  return {
    testTitle: test.value.testTitle,
    title: test.value.testTitle,
    testUrl: getTestUrl(),
    creationDate: test.value.creationDate,
    testDescription: test.value.testDescription,
    cooperatorsEmail: getCooperatorEmails(),
    creatorEmail: test.value.testAdmin?.email || '',
    finalReport: test.value.studyConclusion || buildFallbackConclusion(),
    studyConclusion: test.value.studyConclusion || buildFallbackConclusion(),
    allOptions: test.value.testOptions,
    allAnswers: answers.value,
    finalResult: statisticsData.value,
    finalResultData: statisticsData.value,
    taskAnswers: Object.values(testAnswerDocument.value?.taskAnswers || {}),
    testStructure: test.value.testStructure,
    statisticsByEvaluatorAnswer: heuristicsEvaluator.value,
    heuristicsEvaluator: heuristicsEvaluator.value,
    statisticsByHeuristics: heuristicsStatistics.value,
    heuristicsStatistics: heuristicsStatistics.value,
    timeByHeuristics: timeByHeuristics.value,
    generalStatistics: statisticsData.value,
    statisticsTable: store.state.Answer.evaluatorStatistics,
    evaluatorTimeItems: store.state.Answer.evaluatorStatistics?.items || [],
    type: testAnswerDocument.value?.type || STUDY_TYPES.HEURISTIC,
    heuristicComments: props.heuristicComments,
    evaluatorPercentages: evaluatorPercentages.value,
    heuristicRanking: {
      items: heuristicRankingItems,
    },
    participants: getCooperatorEmails().map((email) => ({ email })),
  }
}

const slugify = (text) =>
  text
    ?.toString()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\-]+/g, '')

const buildPreviewFileName = (suffix = '') => {
  const title = slugify(test.value.testTitle || 'report')
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
  const message = error?.message || fallbackMessage
  previewError.value = message
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
  startPreview('Vista previa del informe sin IA', 'Construyendo PDF...')
  try {
    await openPdfPreview(buildFinalReportItem(), '', {
      showQuickSummary: false,
    })
  } catch (error) {
    console.error('PDF preview failed:', error)
    showPreviewError(error, 'No se pudo generar la vista previa sin IA.')
  } finally {
    isLoading.value = false
  }
}

const previewPdfWithAi = async () => {
  isLoading.value = true
  startPreview(
    'Vista previa del informe con IA',
    'Consultando Ollama/Qwen para redactar el informe...',
  )
  try {
    const finalReportItem = buildFinalReportItem()
    finalReportItem.finalReport = await generateAiFinalReport(finalReportItem)
    finalReportItem.studyConclusion = finalReportItem.finalReport
    await openPdfPreview(finalReportItem, '_ai', { showQuickSummary: false }, generateHeuristicPdfWithAi)
  } catch (error) {
    console.error('AI PDF preview failed:', error)
    previewStatus.value =
      'Ollama ha fallado. Generando una vista previa de respaldo...'

    try {
      const fallbackItem = buildFinalReportItem()
      fallbackItem.finalReport = buildFallbackConclusion()
      fallbackItem.studyConclusion = fallbackItem.finalReport
      await openPdfPreview(fallbackItem, '_ai_fallback', {
        showQuickSummary: false,
      }, generateHeuristicPdf)
    } catch (fallbackError) {
      console.error('AI fallback PDF preview failed:', fallbackError)
      showPreviewError(
        fallbackError,
        'No se pudo generar la vista previa con IA ni la vista previa de respaldo.',
      )
    }
  } finally {
    isLoading.value = false
  }
}

onBeforeUnmount(() => {
  revokePreviewUrl()
})

watch(isPreviewOpen, (value) => {
  if (!value) revokePreviewUrl()
})
</script>
