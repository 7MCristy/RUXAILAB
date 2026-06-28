jest.mock('jspdf', () => {
  const MockJsPDF = function () {
    this.setFont = jest.fn()
    this.setFontSize = jest.fn()
    this.setTextColor = jest.fn()
    this.text = jest.fn()
    this.addPage = jest.fn()
    this.setPage = jest.fn()
    this.getPageWidth = jest.fn().mockReturnValue(595.28)
    this.getPageHeight = jest.fn().mockReturnValue(841.89)
    this.getFontSize = jest.fn().mockReturnValue(11)
    this.getStringUnitWidth = jest.fn().mockReturnValue(10)
    this.internal = {
      scaleFactor: 1,
      pageSize: { width: 595.28, height: 841.89 },
    }
    this.addImage = jest.fn()
    this.save = jest.fn()
    this.setDrawColor = jest.fn()
    this.setFillColor = jest.fn()
    this.rect = jest.fn()
    this.setLineWidth = jest.fn()
    this.line = jest.fn()
    this.splitTextToSize = jest.fn().mockReturnValue(['mock line'])
  }
  return { default: MockJsPDF, __esModule: true }
})

jest.mock('jspdf-autotable', () => {
  return jest.fn()
})

import {
  stripMarkdown,
  stripHtml,
  normalizeText,
  extractCommentTexts,
  getNumber,
  calcStandardDeviation,
} from '@/ux/Heuristic/utils/pdfGenerator'

describe('stripMarkdown', () => {
  it('elimina encabezados #', () => {
    expect(stripMarkdown('# Título')).toBe('Título')
    expect(stripMarkdown('## Subtítulo')).toBe('Subtítulo')
    expect(stripMarkdown('### Nivel 3')).toBe('Nivel 3')
  })

  it('elimina formato bold ** y __', () => {
    expect(stripMarkdown('texto **negrita** aquí')).toBe('texto negrita aquí')
    expect(stripMarkdown('__negrita__')).toBe('negrita')
  })

  it('elimina formato italic * y _', () => {
    expect(stripMarkdown('texto *itálica* aquí')).toBe('texto itálica aquí')
    expect(stripMarkdown('_itálica_')).toBe('itálica')
  })

  it('elimina bold antes que italic para no interferir', () => {
    expect(stripMarkdown('**bold** y *italic*')).toBe('bold y italic')
  })

  it('elimina código inline y bloques de código', () => {
    expect(stripMarkdown('texto `código` aquí')).toBe('texto código aquí')
  })

  it('convierte [texto](url) en texto plano', () => {
    expect(stripMarkdown('[enlace](https://ejemplo.com)')).toBe('enlace')
  })

  it('elimina listas sin ordenar', () => {
    expect(stripMarkdown('- item uno\n- item dos')).toBe('item uno item dos')
    expect(stripMarkdown('* item uno')).toBe('item uno')
  })

  it('elimina listas ordenadas', () => {
    expect(stripMarkdown('1. primer paso\n2. segundo paso')).toBe(
      'primer paso segundo paso',
    )
  })

  it('elimina blockquotes', () => {
    expect(stripMarkdown('> cita importante')).toBe('cita importante')
  })

  it('colapsa múltiples saltos de línea', () => {
    const result = stripMarkdown('párrafo uno\n\n\n\npárrafo dos')
    expect(result).not.toContain('\n\n\n')
  })

  it('retorna string vacío para entrada vacía', () => {
    expect(stripMarkdown('')).toBe('')
    expect(stripMarkdown(null)).toBe('')
    expect(stripMarkdown(undefined)).toBe('')
  })
})

describe('stripHtml', () => {
  it('elimina etiquetas HTML', () => {
    expect(stripHtml('<p>hola</p>')).toBe('hola')
    expect(stripHtml('texto <br> salto')).toBe('texto salto')
    expect(stripHtml('<div class="test">contenido</div>')).toBe('contenido')
  })

  it('colapsa espacios múltiples', () => {
    expect(stripHtml('a    b')).toBe('a b')
  })

  it('retorna string vacío para entrada vacía', () => {
    expect(stripHtml('')).toBe('')
    expect(stripHtml(null)).toBe('')
    expect(stripHtml(undefined)).toBe('')
  })
})

describe('normalizeText', () => {
  it('colapsa espacios y recorta', () => {
    expect(normalizeText('  hola   mundo  ')).toBe('hola mundo')
  })

  it('retorna string vacío para null/undefined', () => {
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
  })
})

describe('getNumber', () => {
  it('convierte string numérico correctamente', () => {
    expect(getNumber('42')).toBe(42)
    expect(getNumber('3.14')).toBe(3.14)
  })

  it('elimina % antes de convertir', () => {
    expect(getNumber('85.5%')).toBe(85.5)
  })

  it('usa coma como decimal', () => {
    expect(getNumber('75,5')).toBe(75.5)
  })

  it('usa fallback para valores inválidos', () => {
    expect(getNumber('abc', 0)).toBe(0)
    expect(getNumber('abc', -1)).toBe(-1)
  })

  it('usa 0 como fallback por defecto', () => {
    expect(getNumber(NaN)).toBe(0)
    expect(getNumber('no-number')).toBe(0)
  })
})

describe('calcStandardDeviation', () => {
  it('calcula desviación estándar correctamente', () => {
    const result = calcStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])
    expect(result).toBeCloseTo(2.0, 1)
  })

  it('retorna 0 para un solo valor', () => {
    expect(calcStandardDeviation([5])).toBe(0)
  })

  it('retorna 0 para array vacío', () => {
    expect(calcStandardDeviation([])).toBe(0)
    expect(calcStandardDeviation(null)).toBe(0)
  })

  it('retorna 0 para valores idénticos', () => {
    expect(calcStandardDeviation([3, 3, 3])).toBe(0)
  })
})

describe('extractCommentTexts', () => {
  it('extrae comentarios del array comments[]', () => {
    const answer = {
      comments: [
        { id: '1', text: 'primer comentario' },
        { id: '2', text: 'segundo comentario' },
      ],
    }
    const result = extractCommentTexts(answer)
    expect(result).toEqual(['primer comentario', 'segundo comentario'])
  })

  it('extrae comentarios del array heuristicAnswer.comments[]', () => {
    const answer = {
      heuristicAnswer: {
        comments: [{ text: 'comentario anidado' }],
      },
    }
    const result = extractCommentTexts(answer)
    expect(result).toContain('comentario anidado')
  })

  it('extrae comentario legacy heuristicComment como string', () => {
    const answer = {
      heuristicComment: '  comentario legacy  ',
    }
    const result = extractCommentTexts(answer)
    expect(result).toContain('comentario legacy')
  })

  it('retorna array vacío si no hay comentarios', () => {
    expect(extractCommentTexts({})).toEqual([])
    expect(extractCommentTexts(null)).toEqual([])
    expect(extractCommentTexts(undefined)).toEqual([])
  })
})
