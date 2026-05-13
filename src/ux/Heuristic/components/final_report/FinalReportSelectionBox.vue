<template>
  <div>
    <v-col class="d-flex flex-column" style="min-height: 500px">
      <!-- Título no topo -->
      <h2>Final Report Content</h2>

      <!-- Puntos más relevantes del informe -->
      <ul class="mt-4" style="padding-left: 1.2rem; line-height: 1.6">
        <li>Descripción del test y metadatos básicos</li>
        <li>Resumen y conclusión general</li>
        <li>Tabla de heurísticas ordenadas por impacto negativo</li>
        <li>Resultados con estadísticas y tablas comparativas por evaluador</li>
        <li>Hallazgos y evidencias (comentarios e imágenes) por heurística</li>
        <li>Recomendaciones priorizadas y posibles mejoras</li>
        <li>Tiempo de evaluación por evaluador y tiempo medio</li>
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
          @click="$emit('return-step')"
        >
          {{ $t('buttons.previous') }}
        </v-btn>
        <div class="d-flex gap-2">
          <v-btn
            v-if="pdfBlobUrl"
            color="success"
            :href="pdfBlobUrl"
            :download="pdfFilename"
            elevation="0"
          >
            Descargar PDF
          </v-btn>
          <v-btn :disabled="isLoading" color="orange" @click="submitPdf">
            <span v-if="!isLoading">{{ $t('pages.finalReport.pdf') }}</span>
            <span v-else>{{ $t('pages.finalReport.options.loading') }}</span>
          </v-btn>
        </div>
      </v-row>
      <!-- Modal preview del informe -->
      <v-dialog v-model="showHtmlReport" width="1000">
        <v-card>
          <v-toolbar flat>
            <v-toolbar-title>Informe - Vista previa</v-toolbar-title>
            <v-spacer />
            <v-btn icon @click="() => (showHtmlReport = false)">
              <v-icon>mdi-close</v-icon>
            </v-btn>
          </v-toolbar>
          <v-card-text style="max-height: 70vh; overflow: auto">
            <div v-html="htmlReportContent"></div>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              color="black"
              :disabled="!pdfBlobUrl"
              variant="flat"
              prepend-icon="mdi-download"
              @click="downloadPdf"
            >
              Descargar informe
            </v-btn>
            <v-btn
              variant="text"
              color="primary"
              @click="showHtmlReport = false"
            >
              Cerrar
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-col>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useStore } from 'vuex'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import {
  buildHeuristicsEvaluator,
  buildHeuristicsStatistics,
  finalResult,
  statistics,
} from '@/ux/Heuristic/utils/statistics'
import {
  buildNarrativeHtmlReport,
  buildNarrativeTextReport,
} from '@/ux/Heuristic/utils/heuristicNarrativeReport'
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
const htmlReportContent = ref('')
const showHtmlReport = ref(false)
const pdfBlobUrl = ref('')
const pdfFilename = ref('')
const testId = computed(() => store.getters.test?.id || '')

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
const resultEvaluator = ref(statistics())

const heuristicsEvaluator = computed(() =>
  buildHeuristicsEvaluator(resultEvaluator.value, test.value.testOptions),
)

const heuristicsStatistics = computed(() =>
  buildHeuristicsStatistics(heuristicsEvaluator.value),
)

// Methods
const submitPdf = async () => {
  isLoading.value = true
  try {
    // Extract valid emails from cooperators
    const getCooperatorEmails = () => {
      const cooperators = test.value.cooperators || []
      return cooperators.filter((coop) => coop?.email).map((coop) => coop.email)
    }

    statisticsData.value = finalResult()
    const cooperatorsEmailsList = getCooperatorEmails()

    // Generate narrative reports
    const htmlReport = buildNarrativeHtmlReport({
      test: test.value,
      testAnswerDocument: testAnswerDocument.value,
      generalStatistics: statisticsData.value,
      statisticsByEvaluator: Array.isArray(
        statisticsData.value?.statisticsByEvaluator,
      )
        ? statisticsData.value.statisticsByEvaluator
        : [],
      statisticsByEvaluatorAnswer: heuristicsEvaluator.value,
      statisticsByHeuristics: heuristicsStatistics.value,
    })

    const textReport = buildNarrativeTextReport({
      test: test.value,
      testAnswerDocument: testAnswerDocument.value,
      generalStatistics: statisticsData.value,
      statisticsByEvaluator: Array.isArray(
        statisticsData.value?.statisticsByEvaluator,
      )
        ? statisticsData.value.statisticsByEvaluator
        : [],
      statisticsByEvaluatorAnswer: heuristicsEvaluator.value,
      statisticsByHeuristics: heuristicsStatistics.value,
      heuristicComments: props.heuristicComments,
    })

    // Store the HTML report and show it in the UI
    htmlReportContent.value = htmlReport
    showHtmlReport.value = true

    const finalReportItem = {
      title: test.value.testTitle,
      creationDate: test.value.creationDate,
      testDescription: test.value.testDescription,
      cooperatorsEmail: cooperatorsEmailsList,
      creatorEmail: test.value.testAdmin?.email || '',
      finalReport: test.value.studyConclusion,
      allOptions: test.value.testOptions,
      allAnswers: answers.value,
      taskAnswers: Object.values(testAnswerDocument.value?.taskAnswers || {}),
      testStructure: test.value.testStructure,
      statisticsByEvaluatorAnswer: heuristicsEvaluator.value,
      statisticsByHeuristics: heuristicsStatistics.value,
      generalStatistics: statisticsData.value,
      statisticsTable: store.state.Answer.evaluatorStatistics,
      type: testAnswerDocument.value?.type || STUDY_TYPES.HEURISTIC,
      heuristicComments: props.heuristicComments,
      htmlReport,
      textReport,
    }
    console.log(finalReportItem)

    const payload = {
      payload: finalReportItem,
    }

    const response = await axios.post(
      `${process.env.VUE_APP_LARAVEL_PDF}/generate-pdf`,
      payload,
      { responseType: 'blob' },
    )

    // Create filename
    const slugify = (text) =>
      text
        ?.toString()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^\w\-]+/g, '')

    const title = slugify(test.value.testTitle || 'report')
    const creationDate = slugify(
      test.value.creationDate || new Date().toISOString(),
    )
    const filename = `final_report_${title}_${creationDate}.pdf`

    // Prepare PDF for manual download (do NOT auto-click)
    const blob = new Blob([response.data], { type: 'application/pdf' })
    // revoke previous if any
    if (pdfBlobUrl.value) URL.revokeObjectURL(pdfBlobUrl.value)
    pdfBlobUrl.value = URL.createObjectURL(blob)
    pdfFilename.value = filename
  } catch (error) {
    console.error('PDF export failed:', error)
  } finally {
    isLoading.value = false
  }
}

const downloadPdf = () => {
  if (!pdfBlobUrl.value) return

  const link = document.createElement('a')
  link.href = pdfBlobUrl.value
  link.download = pdfFilename.value || 'final_report.pdf'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
</script>

<style scoped>
.gap-2 {
  gap: 8px;
}
</style>
