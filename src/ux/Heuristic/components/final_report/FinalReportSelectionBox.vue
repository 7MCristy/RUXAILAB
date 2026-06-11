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
          @click="$emit('return-step')"
        >
          {{ $t('buttons.previous') }}
        </v-btn>
        <v-btn :disabled="isLoading" color="orange" @click="submitPdf">
          <span v-if="!isLoading">{{ $t('pages.finalReport.pdf') }}</span>
          <span v-else>{{ $t('pages.finalReport.options.loading') }}</span>
        </v-btn>
      </v-row>
    </v-col>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useStore } from 'vuex'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import { applyPlugin } from 'jspdf-autotable'
import {
  buildHeuristicsEvaluator,
  buildHeuristicsStatistics,
  finalResult,
  statistics,
} from '@/ux/Heuristic/utils/statistics'
import { STUDY_TYPES } from '@/shared/constants/methodDefinitions'

applyPlugin(jsPDF)

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

// Statistics Results (reactive to store changes)
const resultEvaluator = computed(() => statistics())

const heuristicsEvaluator = computed(() =>
  buildHeuristicsEvaluator(resultEvaluator.value, test.value.testOptions),
)

const heuristicsStatistics = computed(() =>
  buildHeuristicsStatistics(heuristicsEvaluator.value),
)

const slugify = (text) =>
  text
    ?.toString()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\-]+/g, '')

const stripHtml = (html) => {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}

const submitPdf = async () => {
  isLoading.value = true
  try {
    const getCooperatorEmails = () => {
      const cooperators = test.value.cooperators || []
      return cooperators.filter((coop) => coop?.email).map((coop) => coop.email)
    }

    const baseStats = finalResult(resultEvaluator.value)

    // Compute totals from raw answers
    let totalImages = 0
    let totalComments = 0
    answers.value.forEach((evaluator) => {
      if (Array.isArray(evaluator.heuristicQuestions)) {
        evaluator.heuristicQuestions.forEach((heuristic) => {
          if (Array.isArray(heuristic.heuristicQuestions)) {
            heuristic.heuristicQuestions.forEach((question) => {
              const ans = question.heuristicAnswer || {}
              if (Array.isArray(ans.images)) totalImages += ans.images.length
              else if (ans.answerImageUrl) totalImages += 1
              if (Array.isArray(question.comments)) totalComments += question.comments.length
              if (Array.isArray(ans.comments)) totalComments += ans.comments.length
            })
          }
        })
      }
    })

    statisticsData.value = {
      ...baseStats,
      evaluators: resultEvaluator.value.length,
      totalImages,
      totalComments,
    }
    const cooperatorsEmailsList = getCooperatorEmails()

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
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 20
    let y = margin

    // --- Helper functions ---
    const addTitle = (text, size = 18) => {
      doc.setFontSize(size)
      doc.setFont('helvetica', 'bold')
      doc.text(text, pageWidth / 2, y, { align: 'center' })
      y += size / 2 + 4
    }

    const addSubtitle = (text, size = 11) => {
      doc.setFontSize(size)
      doc.setFont('helvetica', 'normal')
      doc.text(text, margin, y)
      y += size / 2 + 3
    }

    const addLabelValue = (label, value, size = 10) => {
      doc.setFontSize(size)
      doc.setFont('helvetica', 'bold')
      doc.text(`${label}: `, margin, y)
      doc.setFont('helvetica', 'normal')
      const labelWidth = doc.getTextWidth(`${label}: `)
      doc.text(String(value || '-'), margin + labelWidth + 1, y)
      y += size / 2 + 3
    }

    const addBodyText = (text, size = 10) => {
      if (!text) return
      doc.setFontSize(size)
      doc.setFont('helvetica', 'normal')
      const lines = doc.splitTextToSize(stripHtml(text), pageWidth - margin * 2)
      lines.forEach((line) => {
        if (y + size > 290) {
          doc.addPage()
          y = margin
        }
        doc.text(line, margin, y)
        y += size / 2 + 2
      })
    }

    const checkPageOverflow = (needed) => {
      if (y + needed > 290) {
        doc.addPage()
        y = margin
        return true
      }
      return false
    }

    // =========================
    // PAGE 1: HEADER & METADATA
    // =========================
    doc.setFillColor(41, 65, 94)
    doc.rect(0, 0, pageWidth, 60, 'F')
    doc.setTextColor(255, 255, 255)
    addTitle('Heuristic Evaluation Report', 22)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'normal')
    doc.text(finalReportItem.title || 'Untitled Test', pageWidth / 2, y, { align: 'center' })
    y += 24

    doc.setTextColor(60, 60, 60)
    y += 6
    addLabelValue('Created', finalReportItem.creationDate || new Date().toISOString().split('T')[0])
    addLabelValue('Creator', finalReportItem.creatorEmail || '-')
    addLabelValue('Evaluators', String(finalReportItem.cooperatorsEmail?.length || 0))
    addLabelValue('Type', finalReportItem.type)

    // Description
    if (finalReportItem.testDescription) {
      y += 4
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text('Description', margin, y)
      y += 8
      addBodyText(finalReportItem.testDescription, 10)
    }

    // Conclusion
    if (finalReportItem.finalReport) {
      y += 4
      checkPageOverflow(14)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text('Conclusion', margin, y)
      y += 8
      addBodyText(finalReportItem.finalReport, 10)
    }

    // ============================
    // STATISTICS BY EVALUATOR
    // ============================
    const evStats = finalReportItem.statisticsByEvaluatorAnswer
    if (evStats?.header?.length > 1 && evStats?.items?.length) {
      y += 6
      checkPageOverflow(40)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('Evaluator Results by Heuristic', margin, y)
      y += 8

      const evHeader = evStats.header.map((h) => h.title || h.value)
      const evBody = evStats.items.map((item) => {
        const row = evStats.header.map((h) => {
          const val = item[h.value || h.title]
          return val != null ? String(val) : '-'
        })
        return row
      })

      doc.autoTable({
        startY: y,
        head: [evHeader],
        body: evBody,
        theme: 'grid',
        headStyles: {
          fillColor: [41, 65, 94],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [240, 243, 248] },
        margin: { left: margin, right: margin },
        styles: { cellPadding: 2.5 },
      })

      y = doc.lastAutoTable.finalY + 8
    }

    // ============================
    // STATISTICS BY HEURISTIC
    // ============================
    const hStats = finalReportItem.statisticsByHeuristics
    if (hStats?.header?.length > 1 && hStats?.items?.length) {
      checkPageOverflow(40)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('Heuristic Statistics', margin, y)
      y += 8

      const hHeader = hStats.header.map((h) => h.title || h.value)
      const hBody = hStats.items.map((item) =>
        hStats.header.map((h) => {
          const val = item[h.value || h.title]
          return val != null ? String(val) : '-'
        }),
      )

      doc.autoTable({
        startY: y,
        head: [hHeader],
        body: hBody,
        theme: 'grid',
        headStyles: {
          fillColor: [41, 65, 94],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [240, 243, 248] },
        margin: { left: margin, right: margin },
        styles: { cellPadding: 2.5 },
      })

      y = doc.lastAutoTable.finalY + 8
    }

    // ============================
    // GENERAL STATISTICS
    // ============================
    const general = finalReportItem.generalStatistics
    if (general && Object.keys(general).length) {
      checkPageOverflow(50)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('General Statistics', margin, y)
      y += 8

      const statRows = [
        ['Average', general.average || '0.00%'],
        ['Maximum', general.max || '0.00%'],
        ['Minimum', general.min || '0.00%'],
        ['Standard Deviation', general.sd || '0.00%'],
      ]
      if (general.avrgWarning) {
        statRows.push(['Avg Warning Threshold', general.avrgWarning])
        statRows.push(['Max Warning Threshold', general.avrgmaxWarning || '0.00%'])
        statRows.push(['Min Warning Threshold', general.avrgminWarning || '0.00%'])
        statRows.push(['Warning Impact', general.impactWarning || '0.00%'])
      }
      statRows.push(['Total Evaluators', String(general.evaluators || 0)])
      statRows.push(['Total Comments', String(general.totalComments || 0)])
      statRows.push(['Total Images', String(general.totalImages || 0)])

      doc.autoTable({
        startY: y,
        head: [['Metric', 'Value']],
        body: statRows,
        theme: 'grid',
        headStyles: {
          fillColor: [41, 65, 94],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [240, 243, 248] },
        margin: { left: margin, right: margin },
        styles: { cellPadding: 2.5 },
      })

      y = doc.lastAutoTable.finalY + 8
    }

    // ============================
    // HEURISTIC COMMENTS
    // ============================
    const comments = finalReportItem.heuristicComments || {}
    const commentKeys = Object.keys(comments).filter((k) => comments[k]?.trim())
    if (commentKeys.length > 0) {
      checkPageOverflow(14)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('Comments by Heuristic', margin, y)
      y += 8

      commentKeys.forEach((key) => {
        checkPageOverflow(14)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.text(`Heuristic: ${key}`, margin, y)
        y += 5
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        const commentLines = doc.splitTextToSize(comments[key], pageWidth - margin * 2 - 4)
        commentLines.forEach((line) => {
          if (y + 5 > 290) {
            doc.addPage()
            y = margin
          }
          doc.text(line, margin + 2, y)
          y += 4.5
        })
        y += 3
      })
    }

    // ============================
    // SAVE & DOWNLOAD
    // ============================
    const titleSlug = slugify(finalReportItem.title || 'report')
    const dateSlug = slugify(finalReportItem.creationDate || new Date().toISOString())
    doc.save(`final_report_${titleSlug}_${dateSlug}.pdf`)
  } catch (error) {
    console.error('PDF export failed:', error)
  } finally {
    isLoading.value = false
  }
}
</script>
