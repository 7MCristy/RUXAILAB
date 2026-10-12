import { FONT, M, PAGE_W, PAGE_H, CONTENT_W, LH, COLORS } from './constants'
import { normalizeText } from '../reportHelpers'

export function addFooter(doc, pageNum) {
  const y = PAGE_H - 20
  doc.setFont(FONT, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.sub)
  doc.text(
    `INFORME DE EVALUACIÓN HEURÍSTICA - Pág. ${pageNum}`,
    PAGE_W / 2,
    y,
    { align: 'center' },
  )
}

/**
 * Builder del layout del PDF: encapsula la paginación (cuándo saltar de
 * página, cabecera/pie, títulos de sección con entrada en el índice, y
 * párrafos justificados). No conoce el CONTENIDO del informe — eso sigue
 * viviendo en pdfGenerator.js, que decide qué texto y tablas van en cada
 * sección y llama a este layout para dibujarlos.
 *
 * El estado real de posición (y, pageNum, tocEntries) sigue viviendo en el
 * llamador (generateHeuristicPdf): este builder opera sobre él a través de
 * los getters/setters que recibe, en vez de poseerlo él mismo. Así el resto
 * del renderizador —todo el contenido de las secciones— no tiene que
 * cambiar ni una línea de cómo lee o escribe `y`/`pageNum`.
 *
 * @param {jsPDF} doc
 * @param {Object} state
 * @param {() => number} state.getY
 * @param {(value: number) => void} state.setY
 * @param {() => number} state.getPageNum
 * @param {(value: number) => void} state.setPageNum
 * @param {(entry: {title: string, page: number}) => void} state.pushTocEntry
 * @param {string} testTitle - Título del test, para la cabecera de página 2+
 */
export function createPdfLayout(doc, state, testTitle) {
  const { getY, setY, getPageNum, setPageNum, pushTocEntry } = state

  function addPageHeader() {
    addFooter(doc, getPageNum())
    if (getPageNum() > 1) {
      doc.setFont(FONT, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...COLORS.sub)
      const headerText = testTitle || 'Informe de evaluación'
      doc.text(headerText, PAGE_W - M, M - 10, { align: 'right' })
      setY(M + 16)
    }
  }

  function newPage() {
    doc.addPage()
    setPageNum(getPageNum() + 1)
    addPageHeader()
  }

  function ensureSpace(needed) {
    if (getY() + needed > PAGE_H - M) {
      newPage()
      doc.setFont(FONT, 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...COLORS.text)
    }
  }

  function startSection(title, size = 18) {
    const lh = size + 4
    ensureSpace(40)
    setY(getY() + 8)
    doc.setFont(FONT, 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...COLORS.accent)
    const titleLines = doc.splitTextToSize(title, CONTENT_W)
    ensureSpace(titleLines.length * lh + 20)
    pushTocEntry({ title, page: getPageNum() })
    doc.text(titleLines, M, getY())
    setY(getY() + titleLines.length * lh)
    doc.setDrawColor(...COLORS.accent)
    doc.setLineWidth(0.4)
    const lineLen = Math.min(size * 3.5, CONTENT_W * 0.4)
    doc.line(M, getY(), M + lineLen, getY())
    setY(getY() + (size === 18 ? 28 : 22))
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.text)
  }

  function writeParagraph(text, opts = {}) {
    const lh = opts.lineHeight || LH
    const x = opts.x || M
    const width = opts.width || CONTENT_W
    doc.setFont(FONT, opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 11)
    doc.setTextColor(...(opts.color || COLORS.text))
    const lines = doc.splitTextToSize(normalizeText(text), width)
    const fontSize = doc.getFontSize()
    const scaleFactor = doc.internal.scaleFactor
    const getTextWidth = (t) =>
      (doc.getStringUnitWidth(t) * fontSize) / scaleFactor

    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lh + 4)
      doc.setFont(FONT, opts.bold ? 'bold' : 'normal')
      doc.setFontSize(opts.size || 11)
      doc.setTextColor(...(opts.color || COLORS.text))
      const line = lines[i]
      const words = line.split(' ').filter(Boolean)
      if (words.length <= 1) {
        doc.text(line, x, getY(), { align: 'left' })
      } else {
        const wordsWidth = words.reduce((sum, w) => sum + getTextWidth(w), 0)
        const availableSpace = width - wordsWidth
        const spaceWidth = availableSpace / (words.length - 1)
        // Skip justification if gaps would be too wide; otherwise keep the same visual style.
        if (spaceWidth > 18 || words.length < 4) {
          doc.text(line, x, getY(), { align: 'left' })
        } else {
          let cx = x
          words.forEach((word) => {
            doc.text(word, cx, getY())
            cx += getTextWidth(word) + spaceWidth
          })
        }
      }
      setY(getY() + lh)
    }

    setY(getY() + (opts.spacing || 6))
    doc.setFont(FONT, 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.text)
  }

  return { addPageHeader, newPage, ensureSpace, startSection, writeParagraph }
}
