/**
 * Constantes de layout y color del informe PDF. Separadas del motor de
 * renderizado para que cualquier otro generador de PDF del proyecto (p.ej.
 * el de ExportPanel.vue, que hoy duplica estos mismos valores) pueda
 * reutilizarlas en vez de redefinirlas.
 */

export const FONT = 'helvetica'
export const M = 52
export const PAGE_W = 595.28
export const PAGE_H = 841.89
export const CONTENT_W = PAGE_W - M * 2
export const LH = 14

export const COLORS = {
  text: [7, 0, 11],
  sub: [140, 140, 140],
  accent: [11, 16, 101],
  tableHead: [44, 115, 181],
  zebra: [246, 246, 246],
  border: [170, 170, 170],
  white: [255, 255, 255],
  green: [56, 85, 36],
  yellow: [224, 170, 102],
  red: [96, 19, 25],
}

export const SEVERITY_COLORS = {
  Leve: [56, 85, 36],
  Moderado: [242, 222, 169],
  Grave: [224, 170, 102],
  Crítico: [196, 7, 13],
}
