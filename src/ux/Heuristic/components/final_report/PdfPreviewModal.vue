<template>
  <v-dialog v-model="show" max-width="1100px" fullscreen>
    <v-card class="pdf-preview">
      <v-toolbar color="orange" dark elevation="0">
        <v-toolbar-title>Previsualización del Informe</v-toolbar-title>
        <v-spacer />
        <v-btn variant="text" icon @click="$emit('close')">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-card-text class="pa-6 preview-content">
        <v-row>
          <v-col cols="12" class="text-center mb-6">
            <v-btn
              color="orange"
              size="large"
              :loading="downloading"
              @click="handleDownload"
            >
              <v-icon start>mdi-download</v-icon>
              Descarregar PDF
            </v-btn>
          </v-col>
        </v-row>

        <!-- PORTADA -->
        <v-sheet class="pa-8 mb-6 cover-page text-center" rounded="lg">
          <v-img
            src="/brand/logo_full.png"
            max-height="60"
            :cover="false"
            class="mx-auto mb-4"
          />
          <h1 class="text-h3 font-weight-bold mb-4">
            INFORME DE EVALUACIÓN HEURÍSTICA
          </h1>
          <h2 class="text-h5 text-grey-darken-1 mb-2">
            {{ testTitle || 'Sistema evaluado' }}
          </h2>
          <p v-if="testUrl" class="text-body-2 text-blue mb-2">
            {{ testUrl }}
          </p>
          <p class="text-body-2 text-grey mb-1">
            Evaluadores: {{ evaluatorNames }}
          </p>
          <p class="text-body-2 text-grey">
            Metodología: 15 Heurísticas de Usabilidad — Nielsen + ISO 9241-110
          </p>
        </v-sheet>

        <!-- SECCIÓN 1: Introducción -->
        <v-sheet class="pa-6 mb-4" rounded="lg">
          <h2 class="text-h4 font-weight-bold mb-4" style="color: #ffa326">
            1. Introducción
          </h2>
          <p class="text-body-1">
            El presente informe recoge los resultados de la evaluación
            heurística realizada al sistema "{{ testTitle }}".
          </p>
          <p class="text-body-1 mt-2">
            La evaluación fue llevada a cabo por
            {{ participants?.length || 0 }} {{ participants?.length === 1 ? 'experto' : 'expertos' }} en usabilidad, utilizando
            un formulario basado en las heurísticas de usabilidad de Nielsen y
            la norma ISO 9241-110.
          </p>
          <p class="text-body-1 mt-2">
            El objetivo principal de esta evaluación es identificar problemas de
            usabilidad, priorizarlos en función de su severidad y proporcionar
            recomendaciones concretas de mejora.
          </p>
          <p class="text-body-1 mt-2">
            La puntuación se calcula como el promedio de las valoraciones de
            todos los evaluadores, normalizado sobre el valor máximo posible y
            expresado en porcentaje de cumplimiento.
          </p>
        </v-sheet>

        <!-- SECCIÓN 2: Resumen Ejecutivo -->
        <v-sheet class="pa-6 mb-4" rounded="lg">
          <h2 class="text-h4 font-weight-bold mb-4" style="color: #ffa326">
            2. Resumen Ejecutivo
          </h2>
          <p class="text-h5 font-weight-bold mb-4">
            Porcentaje medio global de usabilidad:
            {{ finalResultData?.average || '0.00%' }}
          </p>
          <p class="text-body-2 text-grey mb-4">
            Este valor se calcula como el promedio de los porcentajes de todos
            los evaluadores.
          </p>

          <v-data-table
            :headers="evalHeaders"
            :items="evalTableItems"
            :items-per-page="-1"
            density="compact"
            class="elevation-1 mb-4"
            hide-default-footer
          >
            <template #item.percentage="{ item }">
              {{ formatPercentage(item.percentage) }}
            </template>
            <template #item.severity="{ item }">
              <v-chip
                :color="severityColor(item.severity)"
                size="small"
                class="text-white"
              >
                {{ item.severity }}
              </v-chip>
            </template>
          </v-data-table>

          <p class="text-body-1 font-weight-bold mt-4">
            Heurísticas con menor cumplimiento:
          </p>
          <ul class="mt-2">
            <li
              v-for="(h, i) in worstHeuristics"
              :key="i"
              class="text-body-1 ml-4"
            >
              {{ h.name }} — {{ formatPercentage(h.percentage) }} ({{
                h.severity
              }})
            </li>
          </ul>
        </v-sheet>

        <!-- SECCIÓN 3: Ranking -->
        <v-sheet class="pa-6 mb-4" rounded="lg">
          <h2 class="text-h4 font-weight-bold mb-4" style="color: #ffa326">
            3. Ranking de Heurísticas
          </h2>
          <p class="text-body-2 text-grey mb-4">
            Las heurísticas se presentan ordenadas de menor a mayor porcentaje
            de cumplimiento.
          </p>

          <v-data-table
            :headers="rankHeaders"
            :items="rankingItems"
            :items-per-page="-1"
            density="compact"
            class="elevation-1"
            hide-default-footer
          >
            <template #item.percentage="{ item }">
              {{ formatPercentage(item.percentage) }}
            </template>
            <template #item.severity="{ item }">
              <v-chip
                :color="severityColor(item.severity)"
                size="small"
                class="text-white"
              >
                {{ item.severity }}
              </v-chip>
            </template>
          </v-data-table>
        </v-sheet>

        <!-- SECCIÓN 4: Análisis Detallado -->
        <v-sheet class="pa-6 mb-4" rounded="lg">
          <h2 class="text-h4 font-weight-bold mb-4" style="color: #ffa326">
            4. Análisis Detallado por Heurística
          </h2>

          <div
            v-for="(h, index) in rankingItems"
            :key="index"
            class="mb-6 pa-4"
            style="border-left: 4px solid #ffa326"
          >
            <h3 class="text-h5 font-weight-bold">
              {{ h.position }}. {{ h.name }}
            </h3>
            <p
              class="text-subtitle-1 font-weight-bold mb-3"
              :style="{ color: severityColor(h.severity) }"
            >
              [{{ formatPercentage(h.percentage) }} — {{ h.severity }}]
            </p>

            <v-row class="mb-3">
              <v-col cols="6">
                <v-text-field
                  :model-value="formatPercentage(h.percentage)"
                  label="% Cumplimiento"
                  readonly
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="6">
                <v-text-field
                  :model-value="h.severity"
                  label="Severidad"
                  readonly
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </v-col>
            </v-row>

            <!-- Preguntas evaluadas -->
            <p class="text-body-2 mb-2">
              <strong>Preguntas evaluadas:</strong>
            </p>
            <ol class="ml-4 mb-3 text-body-2">
              <li
                v-for="(q, qi) in getHeuristicQuestions(index)"
                :key="qi"
              >
                {{ q.title || q.text || '' }}
              </li>
            </ol>

            <!-- Puntuaciones individuales -->
            <p class="text-body-2 mb-2">
              <strong>Puntuaciones individuales:</strong>
              {{ getEvaluatorScores(h.name) || '—' }}
            </p>

            <!-- Imágenes -->
            <p class="text-body-2 mb-2">
              <strong>Imágenes:</strong>
              {{
                h.totalImages > 0
                  ? `${h.totalImages} ${h.totalImages === 1 ? 'imagen adjunta' : 'imágenes adjuntas'}`
                  : 'Sin imágenes adjuntas'
              }}
            </p>

            <!-- Comentarios editables -->
            <v-textarea
              v-if="!hasEvaluatorComments(h)"
              v-model="editableComments[getHeuristicId(index)]"
              label="Comentarios / Hallazgos"
              placeholder="Escribe los hallazgos de los evaluadores para esta heurística..."
              variant="outlined"
              auto-grow
              rows="3"
              class="mb-3"
            />
            <div v-else class="mb-3">
              <p class="text-body-2 font-weight-bold">
                Hallazgos de los evaluadores:
              </p>
              <ul class="mt-1">
                <li
                  v-for="(comment, ci) in getEvaluatorComments(h)"
                  :key="ci"
                  class="text-body-2 ml-4 mb-1"
                >
                  {{ comment.evaluatorName }}: Se encontraron problemas de
                  usabilidad.
                </li>
              </ul>
            </div>

            <!-- Impacto editable -->
            <v-textarea
              v-model="editableImpact[getHeuristicId(index)]"
              label="Impacto en el usuario"
              placeholder="Describe el impacto que tiene para el usuario el bajo cumplimiento de esta heurística..."
              variant="outlined"
              auto-grow
              rows="2"
              class="mb-3"
            />

            <!-- Recomendaciones editables -->
            <v-textarea
              v-model="editableRecommendations[getHeuristicId(index)]"
              label="Recomendaciones de mejora"
              placeholder="Escribe recomendaciones concretas y accionables..."
              variant="outlined"
              auto-grow
              rows="2"
            />
          </div>
        </v-sheet>

        <!-- SECCIÓN 5: Comparativa -->
        <v-sheet class="pa-6 mb-4" rounded="lg">
          <h2 class="text-h4 font-weight-bold mb-4" style="color: #ffa326">
            5. Comparativa de Puntuaciones por Evaluador
          </h2>
          <p class="text-body-2 text-grey mb-4">
            La siguiente tabla muestra la puntuación otorgada por cada evaluador
            a cada heurística.
          </p>

          <v-data-table
            :headers="crossHeaders"
            :items="crossItems"
            :items-per-page="-1"
            density="compact"
            class="elevation-1 mb-6"
            hide-default-footer
          />

          <h3 class="text-h5 font-weight-bold mb-3" style="color: #ffa326">
            Tiempos por Evaluador
          </h3>
          <v-data-table
            :headers="timeHeaders"
            :items="timeItems"
            :items-per-page="-1"
            density="compact"
            class="elevation-1"
            hide-default-footer
          />
        </v-sheet>

        <!-- SECCIÓN 6: Conclusiones -->
        <v-sheet class="pa-6 mb-4" rounded="lg">
          <h2 class="text-h4 font-weight-bold mb-4" style="color: #ffa326">
            6. Conclusiones y Próximos Pasos
          </h2>

          <v-textarea
            v-model="conclusionText"
            label="Conclusiones"
            placeholder="Escribe las conclusiones de la evaluación..."
            variant="outlined"
            auto-grow
            rows="4"
            class="mb-4"
          />

          <h3 class="text-h6 font-weight-bold mb-2">Prioridades de mejora:</h3>
          <v-list density="compact" class="mb-4">
            <v-list-item
              v-for="(p, pi) in priorityItems"
              :key="pi"
              class="mb-2"
            >
              <template #prepend>
                <v-chip
                  :color="priorityColor(pi)"
                  size="small"
                  class="mr-2"
                >
                  {{ p.label }}
                </v-chip>
              </template>
              <div class="v-list-item-content">
                <div v-if="p.items.length">
                  <div v-for="(h, hi) in p.items" :key="hi" class="text-body-2">
                    • {{ h.name }} — {{ formatPercentage(h.percentage) }}
                  </div>
                </div>
                <div v-else class="text-body-2 text-grey">(No aplica)</div>
              </div>
            </v-list-item>
          </v-list>
        </v-sheet>

        <!-- SECCIÓN 7: Referencias -->
        <v-sheet class="pa-6 mb-4" rounded="lg">
          <h2 class="text-h4 font-weight-bold mb-4" style="color: #ffa326">
            7. Referencias
          </h2>
          <ul class="ml-4">
            <li
              v-for="(ref, ri) in references"
              :key="ri"
              class="text-body-2 mb-2"
            >
              {{ ref }}
            </li>
          </ul>
        </v-sheet>

        <v-row class="mt-4">
          <v-col cols="12" class="text-center">
            <v-btn
              color="orange"
              size="large"
              :loading="downloading"
              @click="handleDownload"
            >
              <v-icon start>mdi-download</v-icon>
              Descarregar PDF
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { generateHeuristicPdf } from '@/ux/Heuristic/utils/pdfGenerator'
import {
  formatTimeSpentFromMs,
  getSeverityLabel,
} from '@/ux/Heuristic/utils/statistics'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  testTitle: { type: String, default: '' },
  testUrl: { type: String, default: '' },
  participants: { type: Array, default: () => [] },
  evaluatorPercentages: {
    type: Object,
    default: () => ({ items: [], globalAverage: '0.00' }),
  },
  heuristicRanking: { type: Object, default: () => ({ items: [] }) },
  heuristicsEvaluator: {
    type: Object,
    default: () => ({ header: [], items: [] }),
  },
  heuristicsStatistics: {
    type: Object,
    default: () => ({ header: [], items: [] }),
  },
  timeByHeuristics: {
    type: Object,
    default: () => ({ header: [], items: [] }),
  },
  evaluatorTimeItems: { type: Array, default: () => [] },
  finalResultData: { type: Object, default: () => ({}) },
  evaluatorComments: { type: Object, default: () => ({}) },
  heuristicComments: { type: Object, default: () => ({}) },
  studyConclusion: { type: String, default: '' },
  testStructure: { type: Array, default: () => [] },
  allAnswers: { type: Array, default: () => [] },
  statisticsByEvaluatorAnswer: { type: [Object, Array], default: () => [] },
  statisticsTable: { type: Object, default: () => ({ header: [], items: [] }) },
  testDescription: { type: String, default: '' },
})

const emit = defineEmits(['close', 'update:modelValue'])

const show = ref(props.modelValue)
const downloading = ref(false)
const conclusionText = ref(props.studyConclusion || '')
const editableComments = ref({})
const editableImpact = ref({})
const editableRecommendations = ref({})

watch(
  () => props.modelValue,
  (val) => {
    show.value = val
    if (val) {
      conclusionText.value = props.studyConclusion || ''
      editableComments.value = {}
      editableImpact.value = {}
      editableRecommendations.value = {}
    }
  },
)

watch(show, (val) => {
  emit('update:modelValue', val)
  if (!val) emit('close')
})

const evaluatorNames = computed(() => {
  return (props.participants || [])
    .filter((p) => p?.fullName || p?.name)
    .map((p) => p.fullName || p.name)
    .join(' · ')
})

const worstHeuristics = computed(() => {
  return rankingItems.value.slice(0, 3)
})

const severityColor = (severity) => {
  switch (severity) {
    case 'Leve':
      return 'green'
    case 'Moderado':
      return 'amber'
    case 'Grave':
      return 'orange'
    case 'Crítico':
      return 'red'
    default:
      return 'grey'
  }
}

const priorityColor = (index) => {
  const colors = ['red', 'orange', 'amber', 'green']
  return colors[index] || 'grey'
}

const evalHeaders = [
  { title: 'Evaluador', key: 'name', align: 'start' },
  { title: '% Usabilidad', key: 'percentage', align: 'center' },
  { title: 'Severidad', key: 'severity', align: 'center' },
]

const evalTableItems = computed(() => {
  const items = (props.evaluatorPercentages?.items || []).map((item, index) =>
    normalizePercentageItem(item, {
      name: item?.name || `Ev${index + 1}`,
    }),
  )
  if (props.finalResultData?.average) {
    items.push({
      name: 'MEDIA GLOBAL',
      percentage: parsePercentage(props.finalResultData.average),
      severity: getSeverityLabel(parsePercentage(props.finalResultData.average)),
    })
  }
  return items
})

const rankHeaders = [
  { title: '#', key: 'position', align: 'center' },
  { title: 'Heurística', key: 'name', align: 'start' },
  { title: '% Cumplimiento', key: 'percentage', align: 'center' },
  { title: 'Severidad', key: 'severity', align: 'center' },
]

const rankingItems = computed(() => {
  return (props.heuristicRanking?.items || []).map((item, index) =>
    normalizePercentageItem(item, {
      name: item?.name || item?.heuristic || `Heurística ${index + 1}`,
      position: index + 1,
    }),
  )
})

const parsePercentage = (value) => {
  const numericValue = Number.parseFloat(
    String(value ?? '')
      .replace('%', '')
      .replace(',', '.'),
  )
  return Number.isFinite(numericValue) ? numericValue : 0
}

const formatPercentage = (value) => `${parsePercentage(value).toFixed(2)}%`

const normalizePercentageItem = (item, fallback = {}) => {
  const percentage = parsePercentage(item?.percentage)
  return {
    ...fallback,
    ...item,
    percentage,
    severity: getSeverityLabel(percentage),
  }
}

const getEvaluatorScores = (heuristicName) => {
  const item = (props.heuristicsEvaluator?.items || []).find(
    (i) => i.heuristic === heuristicName || i.name === heuristicName,
  )
  if (!item) return '—'
  const values = Object.entries(item)
    .filter(([key]) => key.startsWith('Ev'))
    .map(([, val]) => val)
    .filter((v) => v != null)
  return values.length ? values.join(', ') : '—'
}

const getHeuristicQuestions = (index) => {
  const heuristic = props.testStructure?.[index]
  return Array.isArray(heuristic?.heuristicQuestions)
    ? heuristic.heuristicQuestions
    : []
}

const getHeuristicId = (index) => `H${index + 1}`

const hasEvaluatorComments = (h) => {
  const hid = getHeuristicId((h.position || 1) - 1)
  const comments = props.evaluatorComments?.[hid] || []
  return comments.some((c) => c.hasComments)
}

const getEvaluatorComments = (h) => {
  const hid = getHeuristicId((h.position || 1) - 1)
  return props.evaluatorComments?.[hid] || []
}

const crossHeaders = computed(() => {
  return (props.heuristicsEvaluator?.header || []).map((h) => ({
    title: h.title || h.text || h.value || '',
    key: h.value || h.title || '',
    align: 'center',
  }))
})

const crossItems = computed(() => {
  return (props.heuristicsEvaluator?.items || []).map((item) => {
    const row = { heuristic: item.heuristic || item.name || '' }
    ;(props.heuristicsEvaluator?.header || []).forEach((h) => {
      const key = h.value || h.title || ''
      row[key] = item[key] != null ? String(item[key]) : '—'
    })
    return row
  })
})

const timeHeaders = [
  { title: 'Evaluador', key: 'evaluator', align: 'start' },
  { title: 'Tiempo empleado', key: 'totalTime', align: 'center' },
]

const timeItems = computed(() => {
  const items = [...(props.evaluatorTimeItems || [])]
  if (props.finalResultData?.averageTimeMs) {
    items.push({
      evaluator: 'MEDIA GLOBAL',
      totalTime: formatTimeSpentFromMs(props.finalResultData.averageTimeMs),
    })
  }
  return items
})

const priorityItems = computed(() => {
  const items = rankingItems.value
  return [
    {
      label: 'Prioridad 1 — Crítico',
      items: items.filter((h) => h.severity === 'Crítico'),
    },
    {
      label: 'Prioridad 2 — Grave',
      items: items.filter((h) => h.severity === 'Grave'),
    },
    {
      label: 'Prioridad 3 — Moderado',
      items: items.filter((h) => h.severity === 'Moderado'),
    },
    {
      label: 'Prioridad 4 — Mejora continua',
      items: items.filter((h) => h.severity === 'Leve'),
    },
  ]
})

const references = [
  'Nielsen, J. (1994). Usability Engineering. Morgan Kaufmann.',
  'Nielsen, J. (1994). 10 Usability Heuristics for User Interface Design. Nielsen Norman Group.',
  'ISO 9241-110 (2020). Ergonomics of human-system interaction — Part 110: Interaction principles.',
  'ISO 9241-11 (2018). Ergonomics of human-system interaction — Part 11: Usability: Definitions and concepts.',
  'WCAG 2.1 (2018). Web Content Accessibility Guidelines. W3C.',
]

const handleDownload = async () => {
  downloading.value = true
  console.log('[PdfPreviewModal] allAnswers:', props.allAnswers?.length)
  console.log('[PdfPreviewModal] testStructure:', props.testStructure?.length)
  console.log('[PdfPreviewModal] evaluatorPercentages:', props.evaluatorPercentages)
  console.log('[PdfPreviewModal] finalResultData:', props.finalResultData)
  try {
    const reportData = {
      testTitle: props.testTitle,
      testDescription: props.testDescription || '',
      testUrl: props.testUrl,
      evaluatorPercentages: props.evaluatorPercentages,
      heuristicRanking: props.heuristicRanking,
      heuristicsEvaluator: props.heuristicsEvaluator,
      heuristicsStatistics: props.heuristicsStatistics,
      timeByHeuristics: props.timeByHeuristics,
      finalResultData: props.finalResultData,
      evaluatorComments: props.evaluatorComments,
      heuristicComments: {
        ...props.heuristicComments,
        ...editableComments.value,
      },
      studyConclusion: conclusionText.value,
      participants: props.participants,
      testStructure: props.testStructure,
      allAnswers: props.allAnswers,
      statisticsByEvaluatorAnswer: props.statisticsByEvaluatorAnswer,
      statisticsTable: props.statisticsTable,
    }
    await generateHeuristicPdf(reportData)
  } catch (error) {
    console.error('Error generating PDF:', error)
  } finally {
    downloading.value = false
  }
}
</script>

<style scoped>
.pdf-preview {
  background: #f5f7ff;
}
.preview-content {
  max-width: 1000px;
  margin: 0 auto;
}
.preview-content h1,
.preview-content h2,
.preview-content h3,
.preview-content p,
.preview-content li {
  overflow-wrap: anywhere;
  white-space: normal;
}
:deep(.v-data-table__td),
:deep(.v-data-table__th) {
  overflow-wrap: anywhere;
  white-space: normal;
}
.cover-page {
  background: linear-gradient(180deg, #fff8f0 0%, #ffffff 100%);
  border: 1px solid #ffe0b2;
}
</style>
