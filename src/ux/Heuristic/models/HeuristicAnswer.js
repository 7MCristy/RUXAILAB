/**
 * Create a HeuristicAnswer.
 * @param {Object[]} heuristicQuestions  - An array of HeuristicQuestionAnswer value.
 * @param {number} progress - The progress value.
 * @param {number} total - The total value.
 * @param {boolean} submitted - The submitted value.
 * @param {string} userDocId - The userDocId value.
 * @param {number} lastUpdate - The date of the last update.
 */

import Heuristic from './Heuristic'

export default class HeuristicAnswer {
  constructor({
    heuristicQuestions,
    progress,
    total,
    submitted,
    userDocId,
    lastUpdate,
  } = {}) {
    this.heuristicQuestions = heuristicQuestions ?? []
    this.progress = progress ?? 0
    this.total = total ?? 0
    this.submitted = submitted ?? false
    this.userDocId = userDocId ?? null
    this.lastUpdate = lastUpdate ?? 0
  }
  static toHeuristicAnswer(data, testOptions) {
    return new HeuristicAnswer({
      ...data,
      heuristicQuestions: data.heuristicQuestions.map((h) =>
        Heuristic.toHeuristic(h, testOptions),
      ),
    })
  }

  toFirestore() {
    return {
      heuristicQuestions: this.heuristicQuestions.map((h) => {
        // Handle both class instances and raw objects
        if (typeof h?.toFirestore === 'function') {
          return h.toFirestore()
        }
        // Raw object fallback: serialize manually
        return {
          heuristicId: h.heuristicId,
          heuristicTitle: h.heuristicTitle,
          heuristicTotal: h.heuristicTotal,
          timeSpent: h.timeSpent || '00:00',
          heuristicQuestions: Array.isArray(h.heuristicQuestions)
            ? h.heuristicQuestions.map((q) => {
                if (typeof q?.toFirestore === 'function') {
                  return q.toFirestore()
                }
                // Raw question object
                return {
                  heuristicId: q.heuristicId,
                  heuristicAnswer: q.heuristicAnswer || {},
                  heuristicComment: q.heuristicComment || '',
                  answerImageUrl: q.answerImageUrl || '',
                  comments: Array.isArray(q.comments)
                    ? q.comments.map((c) => ({
                        id: c.id,
                        text: c.text,
                        createdAt: c.createdAt,
                        updatedAt: c.updatedAt || null,
                      }))
                    : [],
                  images: Array.isArray(q.images)
                    ? q.images.map((img) => ({
                        id: img.id,
                        url: img.url,
                        createdAt: img.createdAt,
                      }))
                    : [],
                }
              })
            : [],
        }
      }),
      progress: this.progress,
      total: this.total,
      submitted: this.submitted,
      userDocId: this.userDocId,
      lastUpdate: this.lastUpdate,
    }
  }
}
