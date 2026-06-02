<template>
  <div>
    <v-col class="d-flex flex-column" style="min-height: 500px">
      <!-- Título no topo -->
      <h2>{{ reportTitle }}</h2>

      <!-- Lista de conteúdo do relatório -->
      <ul class="mt-4" style="padding-left: 1.2rem; line-height: 1.6">
        <li>{{ reportItems[0] }}</li>
        <li>{{ reportItems[1] }}</li>
        <li>{{ reportItems[2] }}</li>
        <li>{{ reportItems[3] }}</li>
        <li>{{ reportItems[4] }}</li>
        <li>{{ reportItems[5] }}</li>
        <li>{{ reportItems[6] }}</li>
        <li>{{ reportItems[7] }}</li>
      </ul>

      <div v-if="isLoading" class="mt-12">
        <p>{{ loadingMessage }}</p>
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
          {{ previousLabel }}
        </v-btn>
        <v-btn
          :disabled="isLoading"
          color="blue-grey-darken-3"
          @click="submitPdf"
        >
          <span v-if="!isLoading">{{ generateLabel }}</span>
          <span v-else>{{ loadingLabel }}</span>
        </v-btn>
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
            {{ downloadLabel }}
          </v-btn>
          <v-btn icon variant="text" @click="closePreview">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>

        <v-card-text class="pa-0" style="height: calc(100vh - 64px)">
          <iframe
            v-if="previewUrl"
            :src="previewUrl"
            title="Vista previa del informe heurístico"
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
            <p class="mt-4">{{ previewLoadingLabel }}</p>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
/* eslint-disable no-console */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useStore } from 'vuex'
import { generateHeuristicPdf } from '@/ux/Heuristic/utils/pdfGenerator'
import {
  buildHeuristicsEvaluator,
  buildHeuristicsStatistics,
  finalResult,
  formatTimeSpentFromMs,
  getSeverityLabel,
  statistics,
  standardDeviation,
} from '@/ux/Heuristic/utils/statistics'
import { STUDY_TYPES } from '@/shared/constants/methodDefinitions'

// Vuex store
const store = useStore()

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
const reportTitle = 'Final Report Content'
const reportItems = [
  'Test description',
  'Conclusion and final observations',
  'General test data and metadata',
  'Results with statistics and visual tables',
  'All evaluator answers with optional comments and images',
  'Grouped answers by heuristic and evaluator',
  'Professional layout with index and numbered pages',
  'Interactive popup report preview',
]
const loadingMessage =
  'Generating report preview. This operation might take a few minutes.'
const previousLabel = 'Previous'
const generateLabel = 'Preview PDF'
const loadingLabel = 'Loading...'
const previewTitle = 'Previsualización del informe'
const downloadLabel = 'Descargar PDF'
const previewLoadingLabel = 'Generando vista previa del informe...'

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

const evaluatorPercentages = computed(() => {
  const items = (resultEvaluator.value || []).map((item, index) => {
    const percentage = Number.parseFloat(item?.result || '0')
    return {
      name: getEvaluatorDisplayName(item, index),
      percentage: Number.isFinite(percentage) ? percentage.toFixed(2) : '0.00',
      severity: getSeverityLabel(percentage),
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

  console.log(
    '[evaluatorPercentages] resultEvaluator:',
    resultEvaluator.value.length,
    'evaluadores',
  )
  console.log(
    '[evaluatorPercentages] items:',
    JSON.parse(JSON.stringify(items)),
  )
  console.log('[evaluatorPercentages] globalAverage:', globalAverage)

  return { items, globalAverage }
})

const slugify = (text) =>
  text
    ?.toString()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\-]+/g, '')

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
  const link = document.createElement('a')
  link.href = previewUrl.value
  link.download = previewFileName.value
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

onBeforeUnmount(() => {
  revokePreviewUrl()
})

watch(isPreviewOpen, (value) => {
  if (!value) revokePreviewUrl()
})

// Methods
const submitPdf = async () => {
  isLoading.value = true
  try {
    // Extract valid emails from cooperators
    const getCooperatorEmails = () => {
      const cooperators = test.value.cooperators || []
      return cooperators.filter((coop) => coop?.email).map((coop) => coop.email)
    }

    console.log(
      '[FinalReportSelectionBox] testAnswerDocument (raw state):',
      store.state.Answer.testAnswerDocument ? 'OK' : 'null',
    )
    console.log(
      '[FinalReportSelectionBox] testAnswerDocument.heuristicAnswers keys:',
      Object.keys(
        store.state.Answer.testAnswerDocument?.heuristicAnswers || {},
      ),
    )
    console.log(
      '[FinalReportSelectionBox] answers.value:',
      answers.value.length,
      'items',
    )
    console.log(
      '[FinalReportSelectionBox] resultEvaluator:',
      resultEvaluator.value.length,
      'evaluadores',
    )
    if (resultEvaluator.value.length > 0) {
      console.log(
        '[FinalReportSelectionBox] primer evaluador:',
        JSON.parse(JSON.stringify(resultEvaluator.value[0])),
      )
    }
    console.log(
      '[FinalReportSelectionBox] test (getter):',
      store.getters.test ? 'OK' : 'null',
    )
    if (store.getters.test) {
      console.log(
        '[FinalReportSelectionBox] test.testOptions:',
        store.getters.test.testOptions,
      )
    }
    console.log(
      '[FinalReportSelectionBox] evaluatorStatistics:',
      store.state.Answer.evaluatorStatistics,
    )

    statisticsData.value = finalResult()
    console.log(
      '[FinalReportSelectionBox] statisticsData (finalResult):',
      statisticsData.value,
    )

    const cooperatorsEmailsList = getCooperatorEmails()

    const finalReportItem = {
      testTitle: test.value.testTitle,
      title: test.value.testTitle,
      creationDate: test.value.creationDate,
      testDescription: test.value.testDescription,
      cooperatorsEmail: cooperatorsEmailsList,
      creatorEmail: test.value.testAdmin?.email || '',
      finalReport: test.value.studyConclusion,
      allOptions: test.value.testOptions,
      allAnswers: answers.value,
      finalResult: statisticsData.value,
      taskAnswers: Object.values(testAnswerDocument.value?.taskAnswers || {}),
      testStructure: test.value.testStructure,
      statisticsByEvaluatorAnswer: heuristicsEvaluator.value,
      timeByHeuristics: timeByHeuristics.value,
      statisticsByHeuristics: heuristicsStatistics.value,
      generalStatistics: statisticsData.value,
      statisticsTable: store.state.Answer.evaluatorStatistics,
      type: testAnswerDocument.value?.type || STUDY_TYPES.HEURISTIC,
      heuristicComments: props.heuristicComments,
      evaluatorPercentages: evaluatorPercentages.value,
      heuristicRanking: {
        items: [...(heuristicsStatistics.value?.items || [])]
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
          })),
      },
      finalResultData: statisticsData.value,
      participants: cooperatorsEmailsList.map((email) => ({ email })),
    }

    console.log(
      '[FinalReportSelectionBox] finalReportItem keys:',
      Object.keys(finalReportItem),
    )
    console.log('[FinalReportSelectionBox] finalReportItem summary:', {
      testTitle: finalReportItem.testTitle,
      testStructureLength: Array.isArray(finalReportItem.testStructure)
        ? finalReportItem.testStructure.length
        : 0,
      allAnswersLength: Array.isArray(finalReportItem.allAnswers)
        ? finalReportItem.allAnswers.length
        : 0,
      taskAnswersLength: Array.isArray(finalReportItem.taskAnswers)
        ? finalReportItem.taskAnswers.length
        : 0,
      heuristicCommentsKeys: Object.keys(
        finalReportItem.heuristicComments || {},
      ),
      firstHeuristicQuestionCount: Array.isArray(
        finalReportItem.testStructure?.[0]?.heuristicQuestions,
      )
        ? finalReportItem.testStructure[0].heuristicQuestions.length
        : 0,
    })
    console.log(
      '[FinalReportSelectionBox] finalReportItem.testStructure:',
      JSON.parse(JSON.stringify(finalReportItem.testStructure || [])),
    )
    console.log(
      '[FinalReportSelectionBox] finalReportItem.allAnswers[0]:',
      JSON.parse(JSON.stringify(finalReportItem.allAnswers?.[0] || null)),
    )
    console.log(
      '[FinalReportSelectionBox] finalReportItem.heuristicComments:',
      JSON.parse(JSON.stringify(finalReportItem.heuristicComments || {})),
    )
    console.log(
      '[FinalReportSelectionBox] finalReportItem.heuristicComments:',
      JSON.parse(JSON.stringify(finalReportItem.finalReport || {})),
    )

    const title = slugify(test.value.testTitle || 'report')
    const creationDate = slugify(
      test.value.creationDate || new Date().toISOString(),
    )
    const filename = `final_report_${title}_${creationDate}.pdf`

    revokePreviewUrl()
    const previewResult = await generateHeuristicPdf(finalReportItem, {
      mode: 'preview',
    })
    previewUrl.value = previewResult?.url || ''
    previewFileName.value = previewResult?.fileName || filename
    isPreviewOpen.value = Boolean(previewUrl.value)
  } catch (error) {
    throw error
  } finally {
    isLoading.value = false
  }
}
</script>
