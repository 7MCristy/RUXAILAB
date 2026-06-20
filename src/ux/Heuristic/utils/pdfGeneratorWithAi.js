import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatTimeSpentFromMs } from '@/ux/Heuristic/utils/statistics'
import {
  loadLogo,
  normalizeText,
  pluralize,
  stripHtml,
  getNumber,
  getEvaluatorLabel,
  formatDecimal,
  getHeuristicsCellColor,
  getContrastingTextColor,
  parseMmSsToMs,
  getMaxQuestionScore,
  buildHeuristicEvidence,
  getQuestionImageUrls,
  getAllImagesForHeuristic,
  loadImageAsBase64,
} from './pdfGenerator'

const FONT = 'helvetica'
const M = 56
const PAGE_W = 595.28
const PAGE_H = 841.89
const CONTENT_W = PAGE_W - M * 2
const LH = 14

const COLORS = {
  primary: [30, 45, 60],
  secondary: [58, 85, 110],
  accent: [41, 128, 185],
  text: [44, 48, 52],
  sub: [130, 140, 150],
  muted: [220, 225, 230],
  bg: [248, 249, 250],
  white: [255, 255, 255],
  green: [39, 174, 96],
  yellow: [241, 170, 50],
  orange: [225, 130, 40],
  red: [200, 60, 50],
  tableHead: [41, 128, 185],
  tableStripe: [245, 248, 250],
  tableBorder: [220, 225, 230],
}

const SEVERITY_COLORS = {
  Leve: [39, 174, 96],
  Moderado: [241, 170, 50],
  Grave: [225, 130, 40],
  Crítico: [200, 60, 50],
}

const SECTION_NAMES = [
  'introducción',
  'resumen ejecutivo',
  'prioridad',
  'comparativa de puntuaciones',
  'conclusión',
]

const SECTION_PATTERNS = [
  /^SECCI[OÓ]N\s+\d+\s*[-–—]\s*(.+)/im,
  /^\d+[\.\)]\s*(Introducción|Resumen ejecutivo|Prioridad|Análisis detallado|Comparativa|Conclusión)/im,
  /^##+\s*(.+)/im,
  /^\*{1,2}(SECCI[OÓ]N\s+\d+\s*[-–—]\s*.+)\*{1,2}/im,
  /^\*{1,2}(\d+[\.\)]\s*.+)\*{1,2}/im,
  /^(?:SECCI[OÓ]N\s+\d+\s*:?\s*)?(Introducción|Resumen ejecutivo|Prioridad(?: y análisis detallado)?(?: de mejora)?|Análisis detallado|Comparativa|Conclusión)\s*:?\s*$/im,
]

function parseAiSections(aiText) {
  const lines = aiText.split('\n')
  const sections = []
  let currentSection = null
  let currentContent = []

  for (const line of lines) {
    const trimmed = line.trim()
    let matched = false

    for (const pattern of SECTION_PATTERNS) {
      const match = trimmed.match(pattern)
      if (match) {
        if (currentSection) {
          sections.push({
            title: currentSection,
            content: currentContent.join('\n').trim(),
          })
          currentContent = []
        }
        currentSection = match[1] || trimmed
        matched = true
        break
      }
    }

    if (!matched) {
      const lower = trimmed.toLowerCase()
      for (let i = 0; i < SECTION_NAMES.length; i++) {
        if (lower.startsWith(SECTION_NAMES[i]) || lower.includes(SECTION_NAMES[i])) {
          if (currentSection) {
            sections.push({
              title: currentSection,
              content: currentContent.join('\n').trim(),
            })
            currentContent = []
          }
          currentSection = trimmed
          matched = true
          break
        }
      }
    }

    if (!matched) {
      currentContent.push(line)
    }
  }

  if (currentSection) {
    sections.push({
      title: currentSection,
      content: currentContent.join('\n').trim(),
    })
  }

  if (sections.length === 0 && aiText.trim()) {
    sections.push({ title: '', content: aiText.trim() })
  }

  return sections
}

function getSeverityFromPercentage(value) {
  const n = getNumber(value, Number.NaN)
  if (!Number.isFinite(n)) return '—'
  if (n < 50) return 'Crítico'
  if (n < 75) return 'Moderado'
  if (n < 90) return 'Leve'
  return 'Óptimo'
}

/**
 * Parse numbered heuristic analysis blocks from AI text.
 * Matches patterns like:
 *   1. [Heuristic Name]
 *   2. [Heuristic Name]
 *
 * Returns array of { index, name, text } where text is the paragraph content.
 */
function parseNumberedHeuristicBlocks(text) {
  if (!text) return []
  const blocks = []
  const regex = /^(\d+)\.\s*\[([^\]]+)\]\s*$/gm
  const lines = text.split('\n')
  let current = null

  for (const line of lines) {
    const match = regex.exec(line)
    regex.lastIndex = 0
    const trimmed = line.trim()

    const numberedMatch = trimmed.match(/^(\d+)\.\s*\[([^\]]+)\]\s*$/)
    if (numberedMatch) {
      if (current) blocks.push(current)
      current = {
        index: parseInt(numberedMatch[1], 10),
        name: numberedMatch[2].trim(),
        text: '',
      }
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line
    }
  }
  if (current) blocks.push(current)

  return blocks
}

/**
 * Normalize heuristic name for fuzzy matching.
 */
function normalizeHeuristicName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

/**
 * Match a numbered block from AI text to an evidence heuristic item by name similarity.
 */
function matchBlockToEvidenceItem(block, orderedByImpact) {
  if (!block || !orderedByImpact) return null
  const blockNorm = normalizeHeuristicName(block.name)
  for (const item of orderedByImpact) {
    const itemNorm = normalizeHeuristicName(item.label)
    if (itemNorm === blockNorm) return item
    if (itemNorm.includes(blockNorm) || blockNorm.includes(itemNorm)) return item
  }
  return null
}

export async function generateHeuristicPdfWithAi(reportData, options = {}) {
  const {
    testTitle,
    testUrl,
    evaluatorPercentages,
    heuristicsEvaluator: rawHeuristicsEvaluator,
    heuristicsStatistics: rawHeuristicsStatistics,
    statisticsByHeuristics,
    finalResultData,
    heuristicComments,
    testStructure,
    allOptions,
    allAnswers,
    statisticsTable,
    statisticsByEvaluatorAnswer,
    timeByHeuristics,
    finalReport: aiReportText,
    webResearch,
  } = reportData
  const mode = options?.mode || 'download'

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const logo = await loadLogo('/brand/logo_full.png', 30)

  const heuristicsEvaluator =
    rawHeuristicsEvaluator ||
    (statisticsByEvaluatorAnswer?.header && statisticsByEvaluatorAnswer?.items
      ? statisticsByEvaluatorAnswer
      : null)
  const heuristicsStatistics =
    rawHeuristicsStatistics ||
    (statisticsByHeuristics?.header && statisticsByHeuristics?.items
      ? statisticsByHeuristics
      : null)
  const heuristicStatsItems = Array.isArray(heuristicsStatistics?.items)
    ? heuristicsStatistics.items
    : []
  const heuristicMatrixItems = Array.isArray(heuristicsEvaluator?.items)
    ? heuristicsEvaluator.items
    : []
  const evaluatorTimeItems = Array.isArray(statisticsTable?.items)
    ? statisticsTable.items
    : Array.isArray(statisticsByEvaluatorAnswer)
      ? statisticsByEvaluatorAnswer
      : []

  const evidence = buildHeuristicEvidence({
    allAnswers: Array.isArray(allAnswers) ? allAnswers : [],
    testStructure: Array.isArray(testStructure) ? testStructure : [],
    heuristicsStatistics: heuristicStatsItems,
    heuristicComments: heuristicComments || {},
    testOptions: allOptions,
  })

  const globalPct = normalizeText(
    finalResultData?.average ||
      `${evaluatorPercentages?.globalAverage || '0.00'}%`,
  )
  const globalSeverity = getSeverityFromPercentage(globalPct)
  const averageTime = formatTimeSpentFromMs(finalResultData?.averageTimeMs || 0)
  const totalComments = getNumber(finalResultData?.totalComments || 0)
  const totalImages = getNumber(finalResultData?.totalImages || 0)
  const totalWarnings = evidence.heuristics.reduce(
    (sum, item) => sum + item.totalWarnings,
    0,
  )

  let pageNum = 1
  let y = M
  const tocEntries = []

  function addFooter() {
    const fy = PAGE_H - 18
    doc.setDrawColor(...COLORS.muted)
    doc.setLineWidth(0.3)
    doc.line(M, fy - 6, PAGE_W - M, fy - 6)
    doc.setFont(FONT, 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...COLORS.sub)
    doc.text(
      `INFORME DE EVALUACIÓN HEURÍSTICA — ${testTitle || 'Sistema evaluado'}`,
      M,
      fy,
      { align: 'left' },
    )
    doc.text(`Pág. ${pageNum}`, PAGE_W - M, fy, { align: 'right' })
  }

  function ensureSpace(needed) {
    if (y + needed > PAGE_H - M - 14) {
      doc.addPage()
      pageNum += 1
      y = M + 6
      addFooter()
    }
  }

  function startSection(title, size = 16) {
    ensureSpace(50)
    y += 10
    doc.setDrawColor(...COLORS.accent)
    doc.setFillColor(...COLORS.accent)
    doc.rect(M, y, 4, size + 6, 'F')
    doc.setFont(FONT, 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...COLORS.primary)
    doc.text(title, M + 14, y + size - 2)
    tocEntries.push({ title, page: pageNum })
    y += size + 18
    doc.setDrawColor(...COLORS.muted)
    doc.setLineWidth(0.3)
    doc.line(M, y, PAGE_W - M, y)
    y += 12
    doc.setFont(FONT, 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(...COLORS.text)
  }

  function writeParagraph(text, opts = {}) {
    const lh = opts.lineHeight || LH
    const x = opts.x || M
    const width = opts.width || CONTENT_W
    doc.setFont(FONT, opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 10.5)
    doc.setTextColor(...(opts.color || COLORS.text))
    const raw = String(text ?? '')
    const lines = doc.splitTextToSize(normalizeText(raw), width)

    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lh + 2)
      doc.text(lines[i], x, y, { align: 'left' })
      y += lh
    }
    y += opts.spacing || 5
  }

  // ─── SIDEBAR ACCENT ON FIRST PAGE ──────────────────────────────────────
  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, 18, PAGE_H, 'F')
  doc.setFillColor(...COLORS.accent)
  doc.rect(18, 0, 3, PAGE_H, 'F')

  // ─── PORTADA ────────────────────────────────────────────────────────────
  y = M + 40

  if (logo) {
    doc.addImage(
      logo.img,
      'PNG',
      M + 20,
      y,
      logo.width,
      logo.height,
    )
    y += logo.height + 30
  }

  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(1.2)
  doc.line(M + 20, y, M + 160, y)
  y += 30

  doc.setFont(FONT, 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...COLORS.primary)
  doc.text('INFORME DE', M + 20, y)
  y += 26
  doc.text('EVALUACIÓN HEURÍSTICA', M + 20, y)
  y += 40

  doc.setFont(FONT, 'normal')
  doc.setFontSize(14)
  doc.setTextColor(...COLORS.secondary)
  const titleWrapped = doc.splitTextToSize(testTitle || 'Sistema evaluado', CONTENT_W - 60)
  doc.text(titleWrapped, M + 20, y)
  y += titleWrapped.length * 20 + 10

  if (testUrl) {
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.sub)
    doc.text(testUrl, M + 20, y)
    y += 18
  }

  doc.setDrawColor(...COLORS.muted)
  doc.setLineWidth(0.4)
  doc.line(M + 20, y, PAGE_W - M, y)
  y += 18

  doc.setFont(FONT, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.sub)
  const metaLines = [
    `Metodología: 15 Heurísticas de Usabilidad — Nielsen + ISO 9241-110`,
    `Cumplimiento global: ${globalPct} — Severidad: ${globalSeverity}`,
  ]
  if (evaluatorTimeItems.length) {
    const labels = evaluatorTimeItems
      .map((item, i) => getEvaluatorLabel(item, i))
      .filter(Boolean)
      .join(' · ')
    metaLines.push(`Evaluadores: ${labels}`)
  }
  metaLines.forEach((line) => {
    doc.text(line, M + 20, y)
    y += 14
  })

  y = PAGE_H - M - 30
  doc.setFont(FONT, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.sub)
  doc.text('RUXAILAB — Informe generado con inteligencia artificial', M + 20, y)

  // ─── INDICE ─────────────────────────────────────────────────────────────
  doc.addPage()
  pageNum += 1
  y = M + 6
  addFooter()

  doc.setDrawColor(...COLORS.accent)
  doc.setFillColor(...COLORS.accent)
  doc.rect(M, y, 4, 24, 'F')
  doc.setFont(FONT, 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...COLORS.primary)
  doc.text('ÍNDICE', M + 14, y + 18)
  doc.setDrawColor(...COLORS.muted)
  doc.setLineWidth(0.3)
  doc.line(M, y + 30, PAGE_W - M, y + 30)
  y += 40

  const tocEntriesLocal = [...tocEntries]
  tocEntriesLocal.forEach((entry) => {
    if (y > PAGE_H - M - 20) return
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.text)
    const title = normalizeText(entry.title)
    const titleWidth =
      (doc.getStringUnitWidth(title) * doc.getFontSize()) /
      doc.internal.scaleFactor
    doc.text(title, M, y)
    const dotStart = M + titleWidth + 8
    const dotEnd = PAGE_W - M - 24
    if (dotEnd > dotStart) {
      const dotWidth =
        (doc.getStringUnitWidth('.') * doc.getFontSize()) /
        doc.internal.scaleFactor
      const dotCount = Math.max(3, Math.floor((dotEnd - dotStart) / dotWidth))
      const dots = '.'.repeat(dotCount)
      doc.text(dots, dotStart, y)
    }
    doc.setFont(FONT, 'bold')
    doc.setTextColor(...COLORS.accent)
    doc.text(String(entry.page), PAGE_W - M, y, { align: 'right' })
    y += 18
  })

  // ─── PARSE AI TEXT ──────────────────────────────────────────────────────
  const aiSections = parseAiSections(aiReportText || '')
  const sectionTitles = [
    '1. Introducción',
    '2. Resumen ejecutivo',
    '3. Prioridad de mejora y análisis detallado por heurística',
    '4. Comparativa de puntuaciones por evaluador',
    '5. Conclusión',
  ]

  function getSectionContent(sectionIndex) {
    if (aiSections[sectionIndex] && aiSections[sectionIndex].content) {
      return aiSections[sectionIndex].content
    }
    if (aiSections.length === 1 && aiSections[0].content) {
      const paras = aiSections[0].content.split('\n').filter((p) => p.trim())
      const chunkSize = Math.max(1, Math.floor(paras.length / sectionTitles.length))
      const start = sectionIndex * chunkSize
      if (start < paras.length) {
        return paras.slice(start, start + chunkSize).join('\n')
      }
    }
    return ''
  }

  // ─── RENDER SECTIONS ────────────────────────────────────────────────────
  for (let i = 0; i < sectionTitles.length; i++) {
    doc.addPage()
    pageNum += 1
    y = M + 6
    addFooter()

    const title = sectionTitles[i] || `Sección ${i + 1}`
    startSection(title)

    const sectionContent = getSectionContent(i)

    // ── Section 3: INTERLEAVED AI text + tables ──────────────────────────
    if (i === 2) {
      const section3AiText = sectionContent || ''
      const numberedBlocks = parseNumberedHeuristicBlocks(section3AiText)
      console.log('[pdfGeneratorWithAi] Section 3: parsed', numberedBlocks.length, 'numbered blocks')

      // Render ranking table first
      const summaryRows = evidence.orderedByPercentage.map((item) => [
        item.position,
        item.label,
        `${formatDecimal(item.percentage)}%`,
        item.severity,
      ])

      ensureSpace(40)
      writeParagraph(
        'La tabla siguiente presenta el ranking completo de heurísticas ordenado por cumplimiento, utilizado como base para el análisis.',
        { size: 10, spacing: 10, color: COLORS.sub },
      )

      autoTable(doc, {
        startY: y,
        head: [['#', 'Heurística', '%', 'Severidad']],
        body: summaryRows,
        styles: {
          fontSize: 8.5,
          cellPadding: 5,
          font: FONT,
          lineColor: COLORS.tableBorder,
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: COLORS.tableHead,
          textColor: COLORS.white,
          fontStyle: 'bold',
          fontSize: 8.5,
          halign: 'center',
        },
        bodyStyles: {
          textColor: COLORS.text,
        },
        alternateRowStyles: { fillColor: COLORS.tableStripe },
        margin: { left: M, right: M },
        theme: 'grid',
        columnStyles: {
          0: { halign: 'center', cellWidth: 30 },
          1: { cellWidth: CONTENT_W - 120, overflow: 'linebreak' },
          2: { halign: 'center', cellWidth: 45 },
          3: { halign: 'center', cellWidth: 45 },
        },
        didParseCell(data) {
          if (data.section !== 'body') return
          if (data.column.index === 2) {
            const severity = data.row.raw?.[3]
            const color = SEVERITY_COLORS[severity] || COLORS.tableStripe
            data.cell.styles.fillColor = color
            data.cell.styles.textColor = getContrastingTextColor(color)
            data.cell.styles.fontStyle = 'bold'
          }
          if (data.column.index === 3) {
            const color = SEVERITY_COLORS[data.cell.raw] || COLORS.tableStripe
            data.cell.styles.fillColor = color
            data.cell.styles.textColor = getContrastingTextColor(color)
            data.cell.styles.fontStyle = 'bold'
          }
        },
      })
      y = doc.lastAutoTable.finalY + 16

      // Interleave: for each heuristic, render AI text → table → comments → images
      const unmatchedBlocks = [...numberedBlocks]
      for (const item of evidence.orderedByImpact) {
        ensureSpace(80)

        // Heuristic sub-header
        doc.setDrawColor(...COLORS.secondary)
        doc.setFillColor(...COLORS.secondary)
        doc.rect(M, y, 3, 16, 'F')
        doc.setFont(FONT, 'bold')
        doc.setFontSize(12)
        doc.setTextColor(...COLORS.primary)
        doc.text(item.label, M + 10, y + 12)
        y += 22

        // Severity badge inline
        const sv = item.severity
        const svColor = SEVERITY_COLORS[sv] || COLORS.sub
        doc.setFont(FONT, 'normal')
        doc.setFontSize(9)
        doc.setTextColor(...svColor)
        doc.text(
          `Nivel: ${sv}  |  ${formatDecimal(item.percentage)}%  |  Desv. típica: ${formatDecimal(item.sd)}`,
          M + 10,
          y,
        )
        y += 16

        // AI analysis text for this heuristic (from numbered blocks)
        const matchedBlockIndex = unmatchedBlocks.findIndex((b) =>
          matchBlockToEvidenceItem(b, [item]),
        )
        if (matchedBlockIndex >= 0) {
          const block = unmatchedBlocks.splice(matchedBlockIndex, 1)[0]
          const analysisParagraphs = block.text
            .split('\n')
            .filter((p) => p.trim())
            .map((p) => p.trim())
          for (const p of analysisParagraphs) {
            writeParagraph(p, { spacing: 6 })
          }
        }

        // Question table
        if (item.questionSummaries.length > 0) {
          const maxScore = getMaxQuestionScore(allOptions)
          const qRows = item.questionSummaries.map((q) => {
            const avg = q.average
            const maxVal = maxScore || 1
            const pct =
              typeof avg === 'number'
                ? ((avg / maxVal) * 100).toFixed(2).replace('.', ',') + '%'
                : '—'
            return [q.title, pct]
          })

          ensureSpace(qRows.length * 12 + 30)
          autoTable(doc, {
            startY: y,
            head: [['Criterio evaluado', 'Media']],
            body: qRows,
            styles: {
              fontSize: 8,
              cellPadding: 3,
              font: FONT,
              lineColor: COLORS.tableBorder,
              lineWidth: 0.1,
            },
            headStyles: {
              fillColor: COLORS.tableHead,
              textColor: COLORS.white,
              fontStyle: 'bold',
              fontSize: 8,
            },
            alternateRowStyles: { fillColor: COLORS.tableStripe },
            margin: { left: M + 8, right: M },
            theme: 'grid',
            columnStyles: {
              0: { overflow: 'linebreak' },
              1: { halign: 'center', cellWidth: 40 },
            },
          })
          y = doc.lastAutoTable.finalY + 12
        }

        // Comments
        const allCommentDetails = item.questionSummaries.flatMap((q) => q.commentDetails || [])
        console.log(
          '[pdfGeneratorWithAi] Heuristic #' + (item.position || '?') + ' commentDetails:',
          allCommentDetails.length,
          'items',
          allCommentDetails.map((c) => c.evaluatorName + ': ' + c.text.substring(0, 50)),
        )
        if (allCommentDetails.length > 0) {
          doc.setFont(FONT, 'bold')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.primary)
          doc.text('Comentarios de los evaluadores:', M + 8, y)
          y += 13
          for (const cd of allCommentDetails) {
            const commentLine = `${cd.evaluatorName}: "${stripHtml(cd.text)}"`
            const wrapped = doc.splitTextToSize(commentLine, CONTENT_W - 24)
            for (const line of wrapped) {
              ensureSpace(12)
              doc.setFont(FONT, 'normal')
              doc.setFontSize(8.5)
              doc.setTextColor(...COLORS.text)
              doc.text(line, M + 12, y)
              y += 11
            }
            y += 2
          }
        }

        // Images
        const hIndex = (item.position || 1) - 1
        const imgUrls = getAllImagesForHeuristic(allAnswers, hIndex, testStructure)
        console.log(
          '[pdfGeneratorWithAi] Heuristic #' + (item.position || '?') + ' imgUrls:',
          imgUrls.length,
          imgUrls.slice(0, 4),
        )
        if (imgUrls.length > 0) {
          doc.setFont(FONT, 'bold')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.primary)
          doc.text(`Evidencias visuales (${imgUrls.length}):`, M + 8, y)
          y += 13
          const maxImgs = Math.min(imgUrls.length, 4)
          for (let ii = 0; ii < maxImgs; ii++) {
            try {
              const base64 = await loadImageAsBase64(imgUrls[ii])
              if (base64) {
                ensureSpace(110)
                const imgWidth = Math.min(CONTENT_W - 24, 200)
                const imgHeight = 80
                doc.addImage(base64, 'JPEG', M + 12, y, imgWidth, imgHeight)
                y += imgHeight + 6
              }
            } catch {
              ensureSpace(12)
              doc.setFont(FONT, 'normal')
              doc.setFontSize(8)
              doc.setTextColor(...COLORS.sub)
              doc.text(`Imagen: ${imgUrls[ii]}`, M + 12, y)
              y += 11
            }
          }
        }

        // Metadata: warnings, images, comments
        const metaBits = []
        if (item.totalWarnings > 0) {
          metaBits.push(
            `${item.totalWarnings} ${pluralize(item.totalWarnings, 'warning', 'warnings')}`,
          )
        }
        if (item.totalImages > 0) {
          metaBits.push(
            `${item.totalImages} ${pluralize(item.totalImages, 'evidencia visual', 'evidencias visuales')}`,
          )
        }
        if (metaBits.length) {
          doc.setFont(FONT, 'normal')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.sub)
          doc.text(`Datos registrados: ${metaBits.join(', ')}.`, M + 8, y)
          y += 13
        }
        if (normalizeText(item.comments)) {
          doc.setFont(FONT, 'italic')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.secondary)
          const commentText = `Comentarios: ${stripHtml(item.comments)}`
          const wrapped = doc.splitTextToSize(commentText, CONTENT_W - 16)
          for (const line of wrapped) {
            ensureSpace(12)
            doc.text(line, M + 8, y)
            y += 11
          }
          y += 4
        }

        y += 8
      }

      // Render any unmatched AI text blocks as fallback
      for (const block of unmatchedBlocks) {
        ensureSpace(40)
        writeParagraph(`${block.name}:`, { bold: true, spacing: 6 })
        const paragraphs = block.text.split('\n').filter((p) => p.trim())
        for (const p of paragraphs) {
          writeParagraph(p.trim(), { spacing: 6 })
        }
      }
    }

    // ── Other sections: render AI text paragraphs ─────────────────────────
    if (i !== 2 && sectionContent) {
      const paragraphs = sectionContent
        .split('\n')
        .filter((p) => p.trim())
        .map((p) => p.trim())
      for (const p of paragraphs) {
        writeParagraph(p, { spacing: 6 })
      }
    }

    // ── Section 4: evaluator matrix + time stats ─────────────────────────
    if (i === 3) {
      const matrixHeaders = Array.isArray(heuristicsEvaluator?.header)
        ? heuristicsEvaluator.header.map(
            (h) => h.title || h.text || h.value || '',
          )
        : []
      const heuristicNameByIndex = Array.isArray(testStructure)
        ? testStructure.map((h, idx) => {
            const id = normalizeText(
              h?.id || h?.heuristicId || `H${idx + 1}`,
            )
            const title = normalizeText(
              h?.title || h?.heuristicTitle || h?.name,
            )
            return title ? `${id} — ${title}` : id
          })
        : []
      const matrixRows = heuristicMatrixItems.map((item, rowIndex) => ({
        heuristic: heuristicNameByIndex[rowIndex] || item.heuristic || '—',
        max: Number(item.max),
        min: Number(item.min),
        values: matrixHeaders.map((_, colIdx) => {
          if (colIdx === 0)
            return heuristicNameByIndex[rowIndex] || item.heuristic || '—'
          const key = heuristicsEvaluator.header?.[colIdx]?.value
          const val = item?.[key]
          return val != null ? formatDecimal(val) : '0,00'
        }),
      }))
      const matrixBody = matrixRows.map((row) => row.values)
      const heurColW = Math.max(180, Math.min(CONTENT_W * 0.44, 250))
      const evCount = Math.max(1, matrixHeaders.length - 1)
      const evColW = (CONTENT_W - heurColW) / evCount
      const matrixColStyles = {
        0: {
          halign: 'left',
          fontStyle: 'bold',
          textColor: COLORS.primary,
          cellWidth: heurColW,
          overflow: 'linebreak',
        },
      }
      for (let idx = 1; idx < matrixHeaders.length; idx += 1) {
        matrixColStyles[idx] = { halign: 'center', cellWidth: evColW }
      }

      if (matrixHeaders.length > 1) {
        writeParagraph(
          'Matriz de puntuaciones medias por heurística y evaluador. Los colores reflejan el nivel relativo dentro de cada fila.',
          { size: 10, spacing: 8, color: COLORS.sub },
        )

        ensureSpace(matrixBody.length * 12 + 30)
        autoTable(doc, {
          startY: y,
          head: [matrixHeaders],
          body: matrixBody,
          styles: {
            fontSize: 7.5,
            cellPadding: 4,
            font: FONT,
            halign: 'center',
            valign: 'middle',
            lineColor: COLORS.tableBorder,
            lineWidth: 0.1,
          },
          columnStyles: matrixColStyles,
          headStyles: {
            fillColor: COLORS.tableHead,
            textColor: COLORS.white,
            fontStyle: 'bold',
            fontSize: 7.5,
          },
          alternateRowStyles: { fillColor: COLORS.tableStripe },
          tableWidth: CONTENT_W,
          margin: { left: M, right: M },
          theme: 'grid',
          didParseCell(data) {
            if (data.section !== 'body' || data.column.index === 0) return
            const row = matrixRows[data.row.index]
            const color = getHeuristicsCellColor(
              data.cell.raw,
              row?.max,
              row?.min,
            )
            data.cell.styles.fillColor = color.fill
            data.cell.styles.textColor = color.text
            data.cell.styles.fontStyle = 'bold'
          },
        })
        y = doc.lastAutoTable.finalY + 14
      }

      // ── Time stats ────────────────────────────────────────────────────
      const timeHeader = Array.isArray(timeByHeuristics?.header)
        ? timeByHeuristics.header
        : []
      const timeItems = Array.isArray(timeByHeuristics?.items)
        ? timeByHeuristics.items
        : []
      const filteredTimeHeader = timeHeader.filter(
        (h) => (h?.value || '') !== 'timeSd',
      )
      const timeLabels = filteredTimeHeader.map(
        (h) => h?.title || h?.text || h?.value || '',
      )
      const timeRows = timeItems.map((item) =>
        filteredTimeHeader.map((h) => {
          const key = h?.value
          return item?.[key] != null ? String(item[key]) : '—'
        }),
      )
      const maxTimeMs = Math.max(
        ...timeItems.map((item) =>
          Math.max(
            parseMmSsToMs(item?.totalTime),
            parseMmSsToMs(item?.averageTime),
          ),
        ),
        0,
      )

      if (timeLabels.length > 1 && timeRows.length) {
        ensureSpace(40)
        writeParagraph(
          'Tiempos registrados por heurística y evaluador:',
          { size: 10, spacing: 6, color: COLORS.sub },
        )

        autoTable(doc, {
          startY: y,
          head: [timeLabels],
          body: timeRows,
          styles: {
            fontSize: 7.5,
            cellPadding: 3,
            font: FONT,
            lineColor: COLORS.tableBorder,
            lineWidth: 0.1,
          },
          headStyles: {
            fillColor: COLORS.tableHead,
            textColor: COLORS.white,
            fontStyle: 'bold',
            fontSize: 7.5,
          },
          alternateRowStyles: { fillColor: COLORS.tableStripe },
          margin: { left: M, right: M },
          theme: 'grid',
          didParseCell(data) {
            if (data.section !== 'body' || data.column.index === 0) return
            const hk = filteredTimeHeader[data.column.index]?.value
            const rawMs = parseMmSsToMs(data.cell.raw)
            if (
              hk?.startsWith('Ev') ||
              hk === 'totalTime' ||
              hk === 'averageTime'
            ) {
              const color = getTimeColors(rawMs, maxTimeMs)
              data.cell.styles.fillColor = color.fill
              data.cell.styles.textColor = color.text
              data.cell.styles.fontStyle = 'bold'
            }
          },
        })
        y = doc.lastAutoTable.finalY + 12
      }

      doc.setFont(FONT, 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...COLORS.sub)
      doc.text(`Tiempo medio de ejecución global: ${averageTime}.`, M, y)
      y += 16
    }

    // ── Section 5: conclusion metadata ──────────────────────────────────
    if (i === 4) {
      ensureSpace(40)
      doc.setDrawColor(...COLORS.muted)
      doc.setLineWidth(0.3)
      doc.line(M, y, PAGE_W - M, y)
      y += 14

      doc.setFont(FONT, 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.sub)
      doc.text('DATOS DEL ESTUDIO', M, y)
      y += 14

      doc.setFont(FONT, 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)

      const summaryLines = [
        `Cumplimiento global: ${globalPct} (${globalSeverity})`,
        `Total de warnings: ${totalWarnings}`,
        `Comentarios registrados: ${totalComments}`,
        `Evidencias visuales: ${totalImages}`,
        `Tiempo medio: ${averageTime}`,
      ]
      for (const line of summaryLines) {
        doc.text(line, M + 8, y)
        y += 13
      }
    }
  }

  // ─── WEB RESEARCH APPENDIX ──────────────────────────────────────────────
  if (webResearch && typeof webResearch === 'string' && webResearch.trim()) {
    doc.addPage()
    pageNum += 1
    y = M + 6
    addFooter()

    // Add to TOC
    tocEntries.push({ title: 'Análisis Web (RAG)', page: pageNum })

    doc.setDrawColor(...COLORS.accent)
    doc.setFillColor(...COLORS.accent)
    doc.rect(M, y, 4, 24, 'F')
    doc.setFont(FONT, 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...COLORS.primary)
    doc.text('ANÁLISIS WEB (RAG)', M + 14, y + 18)
    doc.setDrawColor(...COLORS.muted)
    doc.setLineWidth(0.3)
    doc.line(M, y + 30, PAGE_W - M, y + 30)
    y += 40

    doc.setFont(FONT, 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...COLORS.sub)
    doc.text(
      'Investigación web realizada por Jina AI / TinyFish como contexto adicional para el análisis.',
      M,
      y,
    )
    y += 14

    // Split web research content into paragraphs and render
    const webLines = webResearch.split('\n').filter((l) => l.trim())
    for (const line of webLines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('### ')) {
        ensureSpace(20)
        doc.setFont(FONT, 'bold')
        doc.setFontSize(11)
        doc.setTextColor(...COLORS.primary)
        doc.text(trimmed.replace(/^#+\s*/, ''), M, y)
        y += 14
      } else if (trimmed.startsWith('## ')) {
        ensureSpace(22)
        doc.setFont(FONT, 'bold')
        doc.setFontSize(13)
        doc.setTextColor(...COLORS.primary)
        doc.text(trimmed.replace(/^#+\s*/, ''), M, y)
        y += 16
      } else if (trimmed.startsWith('# ')) {
        ensureSpace(24)
        doc.setFont(FONT, 'bold')
        doc.setFontSize(15)
        doc.setTextColor(...COLORS.primary)
        doc.text(trimmed.replace(/^#+\s*/, ''), M, y)
        y += 18
      } else if (trimmed.startsWith('=== ')) {
        ensureSpace(18)
        doc.setFont(FONT, 'bold')
        doc.setFontSize(10)
        doc.setTextColor(...COLORS.secondary)
        const sectionLabel = trimmed.replace(/^=+/, '').replace(/=+$/, '').trim()
        doc.text(sectionLabel, M, y)
        y += 13
      } else if (trimmed.startsWith('URL:')) {
        ensureSpace(12)
        doc.setFont(FONT, 'italic')
        doc.setFontSize(8)
        doc.setTextColor(...COLORS.sub)
        doc.text(trimmed, M + 8, y)
        y += 10
      } else {
        ensureSpace(14)
        const wrapped = doc.splitTextToSize(trimmed, CONTENT_W)
        for (const wl of wrapped) {
          ensureSpace(12)
          doc.setFont(FONT, 'normal')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.text)
          doc.text(wl, M, y)
          y += 11
        }
      }
    }
  }

  // ─── UPDATE INDEX WITH REAL PAGE NUMBERS ──────────────────────────────
  doc.setPage(2)
  let tocY = M + 40
  doc.setFont(FONT, 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.text)
  const renderedTitles = tocEntries.slice(0, sectionTitles.length)
  renderedTitles.forEach((entry) => {
    if (tocY > PAGE_H - M - 20) return
    const title = normalizeText(entry.title)
    const tw =
      (doc.getStringUnitWidth(title) * doc.getFontSize()) /
      doc.internal.scaleFactor
    doc.text(title, M, tocY)
    const dotStart = M + tw + 8
    const dotEnd = PAGE_W - M - 24
    if (dotEnd > dotStart) {
      const dw =
        (doc.getStringUnitWidth('.') * doc.getFontSize()) /
        doc.internal.scaleFactor
      const dc = Math.max(3, Math.floor((dotEnd - dotStart) / dw))
      doc.text('.'.repeat(dc), dotStart, tocY)
    }
    doc.setFont(FONT, 'bold')
    doc.setTextColor(...COLORS.accent)
    doc.text(String(entry.page), PAGE_W - M, tocY, { align: 'right' })
    doc.setFont(FONT, 'normal')
    doc.setTextColor(...COLORS.text)
    tocY += 18
  })

  const fileName = `informe_heurística_IA_${
    testTitle ? testTitle.replace(/\s+/g, '_').toLowerCase() : 'evaluación'
  }.pdf`

  doc.deletePage(2)

  if (mode === 'download') {
    doc.save(fileName)
    return { fileName }
  }

  if (mode === 'preview') {
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    return { fileName, blob, url }
  }

  const blob = doc.output('blob')
  return { fileName, blob }
}

function getTimeColors(valueMs, maxMs) {
  if (!maxMs || valueMs <= 0) return { fill: [245, 248, 250], text: [44, 48, 52] }
  const ratio = valueMs / maxMs
  if (ratio < 0.33) return { fill: [230, 245, 235], text: [39, 174, 96] }
  if (ratio < 0.66) return { fill: [255, 248, 225], text: [180, 130, 20] }
  return { fill: [255, 235, 230], text: [200, 60, 50] }
}
