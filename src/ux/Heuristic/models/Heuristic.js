/**
 * Create a Heuristic.
 * @param {number} id - The heuristicId value.
 * @param {string} title - The heuristicTitle value.
 * @param {Object[]} questions  - An array of HeuristicQuestion value.
 * @param {number} total -Total number of heuristics
 */

import HeuristicQuestionAnswer from './HeuristicQuestionAnswer'

export default class Heuristic {
  constructor({
    heuristicId,
    heuristicTitle,
    heuristicQuestions,
    heuristicTotal,
    timeSpent,
  } = {}) {
    this.heuristicId = heuristicId
    this.heuristicTitle = heuristicTitle
    this.heuristicQuestions = heuristicQuestions
    this.heuristicTotal = heuristicTotal
    this.timeSpent = timeSpent ?? '00:00'
  }
  static toHeuristic(data, testOptions) {
    return new Heuristic({
      ...data,
      heuristicQuestions: data.heuristicQuestions.map((h) =>
        HeuristicQuestionAnswer.toHeuristicQuestionAnswer(h, testOptions),
      ),
    })
  }

  toFirestore() {
    return {
      heuristicId: this.heuristicId,
      heuristicTitle: this.heuristicTitle,
      heuristicQuestions: this.heuristicQuestions.map((h) => {
        // Handle both class instances and raw objects
        if (typeof h?.toFirestore === 'function') {
          return h.toFirestore()
        }
        // Raw object fallback
        return {
          heuristicId: h.heuristicId,
          heuristicAnswer: h.heuristicAnswer || {},
          heuristicComment: h.heuristicComment || '',
          answerImageUrl: h.answerImageUrl || '',
          comments: Array.isArray(h.comments)
            ? h.comments.map((c) => ({
                id: c.id,
                text: c.text,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt || null,
              }))
            : [],
          images: Array.isArray(h.images)
            ? h.images.map((img) => ({
                id: img.id,
                url: img.url,
                createdAt: img.createdAt,
              }))
            : [],
        }
      }),
      heuristicTotal: this.heuristicTotal,
      timeSpent: this.timeSpent,
    }
  }
}
