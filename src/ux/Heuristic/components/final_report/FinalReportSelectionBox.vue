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
            v-else
            class="d-flex flex-column align-center justify-center"
            style="height: 100%"
          >
            <v-progress-circular
              indeterminate
              color="blue-grey-darken-3"
              size="48"
            />
            <p class="mt-4">Generando vista previa...</p>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { useStore } from 'vuex'
import { useI18n } from 'vue-i18n'
import { generateHeuristicPdf } from '@/ux/Heuristic/utils/pdfGenerator'
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

// Vuex store
const store = useStore()

// Vue I18n
const { t } = useI18n()

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

const getEvaluatorDisplayName = (evaluator, index) => {
  const cooperators = test.value?.cooperators || []
  const cooperator = cooperators.find(
    (item) =>
      item?.userDocId === evaluator?.userDocId ||
      item?.uid === evaluator?.userDocId ||
      item?.id === evaluator?.userDocId ||
      item?.email === evaluator?.email,
  )

  return (
    cooperator?.fullName ||
    cooperator?.name ||
    cooperator?.displayName ||
    cooperator?.email ||
    evaluator?.fullName ||
    evaluator?.name ||
    evaluator?.displayName ||
    evaluator?.email ||
    evaluator?.userDocId ||
    `Ev${index + 1}`
  )
}

const evaluatorPercentages = computed(() => {
  const items = (resultEvaluator.value || []).map((item, index) => {
    const percentage = Number.parseFloat(item?.result || '0')
    const safePercentage = Number.isFinite(percentage) ? percentage : 0

    return {
      name: getEvaluatorDisplayName(item, index),
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
  const ollamaUrl =
    process.env.VUE_APP_OLLAMA_API_URL || 'http://localhost:11434/api/chat'
  const body = buildOllamaRequestBody(finalReportItem)

  const response = await fetch(ollamaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Ollama report generation failed: ${response.status}`)
  }

  const { message } = await response.json()
  return message?.content || finalReportItem.finalReport || ''
}

const getCooperatorEmails = () => {
  const cooperators = test.value.cooperators || []
  return cooperators.filter((coop) => coop?.email).map((coop) => coop.email)
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
    creationDate: test.value.creationDate,
    testDescription: test.value.testDescription,
    cooperatorsEmail: getCooperatorEmails(),
    creatorEmail: test.value.testAdmin?.email || '',
    finalReport: test.value.studyConclusion,
    studyConclusion: test.value.studyConclusion,
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

const openPdfPreview = async (finalReportItem, suffix = '') => {
  revokePreviewUrl()

  const previewResult = await generateHeuristicPdf(finalReportItem, {
    mode: 'preview',
  })

  previewUrl.value = previewResult?.url || ''
  previewFileName.value = suffix
    ? buildPreviewFileName(suffix)
    : previewResult?.fileName || buildPreviewFileName()
  isPreviewOpen.value = Boolean(previewUrl.value)
}

const previewPdf = async () => {
  isLoading.value = true
  try {
    previewTitle.value = 'Vista previa del informe sin IA'
    await openPdfPreview(buildFinalReportItem())
  } catch (error) {
    console.error('PDF preview failed:', error)
  } finally {
    isLoading.value = false
  }
}

const previewPdfWithAi = async () => {
  isLoading.value = true
  try {
    const finalReportItem = buildFinalReportItem()
    finalReportItem.finalReport = await generateAiFinalReport(finalReportItem)
    finalReportItem.studyConclusion = finalReportItem.finalReport
    previewTitle.value = 'Vista previa del informe con IA'
    await openPdfPreview(finalReportItem, '_ai')
  } catch (error) {
    console.error('AI PDF preview failed:', error)
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
