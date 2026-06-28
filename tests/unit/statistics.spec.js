jest.mock('@/store', () => {
  const mockTestOptions = [
    { value: 0 },
    { value: 1 },
    { value: 2 },
    { value: 3 },
    { value: 4 },
  ]
  const mockTest = {
    testOptions: mockTestOptions,
  }
  const store = {
    getters: {
      test: mockTest,
    },
  }
  return { default: store, __esModule: true }
})

import { calcFinalResult } from '@/ux/Heuristic/utils/statistics'

describe('calcFinalResult', () => {
  it('calcula porcentaje final correctamente con heurísticas básicas', () => {
    const heuristics = [
      { id: 'H1', result: 35, SumOfValues: 10, totalNoAplication: 0, totalWarnings: 2, timeSpentMs: 120000 },
      { id: 'H2', result: 28, SumOfValues: 8, totalNoAplication: 1, totalWarnings: 0, timeSpentMs: 90000 },
    ]

    const result = calcFinalResult(heuristics)

    // applicableQuestions = (10-0) + (8-1) = 17
    // maxPerfectResult = 17 * 4 = 68
    // result = 35 + 28 = 63
    // finalPct = (63 * 100) / 68 = 92.65
    expect(result.result).toBe('92.65')
    expect(result.totalWarnings).toBe(2)
  })

  it('maneja totalWarnings vacío (no warnings)', () => {
    const heuristics = [
      { id: 'H1', result: 40, SumOfValues: 10, totalNoAplication: 0, totalWarnings: 0, timeSpentMs: 60000 },
    ]

    const result = calcFinalResult(heuristics)

    expect(result.result).toBe('100.00')
    expect(result.totalWarnings).toBe(0)
    expect(result.baseWarning).toBe('100.00')
  })

  it('incluye warnings en baseWarning y maxWarning', () => {
    const heuristics = [
      { id: 'H1', result: 20, SumOfValues: 10, totalNoAplication: 0, totalWarnings: 3, timeSpentMs: 60000 },
    ]

    const result = calcFinalResult(heuristics)

    // applicableQuestions = 10, maxOption = 4
    // maxPerfectResult = 40
    // finalPct = 20*100/40 = 50.00
    expect(result.result).toBe('50.00')
    // maxPerfResultWarnings = (10+3) * 4 = 52
    // baseWarning = 20*100/52 = 38.46
    expect(result.baseWarning).toBe('38.46')
    // maxWarning = (20+3*4)*100/52 = 32*100/52 = 61.54
    expect(result.maxWarning).toBe('61.54')
    expect(result.totalWarnings).toBe(3)
  })

  it('maneja resultado -1 como 0', () => {
    const heuristics = [
      { id: 'H1', result: -1, SumOfValues: 10, totalNoAplication: 0, totalWarnings: 0, timeSpentMs: 60000 },
    ]

    const result = calcFinalResult(heuristics)

    expect(result.result).toBe('0.00')
  })

  it('retorna 0.00 si no hay preguntas aplicables', () => {
    const heuristics = [
      { id: 'H1', result: 0, SumOfValues: 0, totalNoAplication: 0, totalWarnings: 0, timeSpentMs: 0 },
    ]

    const result = calcFinalResult(heuristics)

    expect(result.result).toBe('0.00')
  })

})
