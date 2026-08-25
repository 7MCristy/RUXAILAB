import { functions } from '../f.firebase.js'
import logger from '../utils/logger.js'

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(
    /\/$/,
    '',
  )
}

export const ollamaReport = functions.onRequest({
  opts: {
    cors: true,
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  handler: async (req, res) => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('')
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    try {
      const ollamaBaseUrl = getOllamaBaseUrl()
      const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(290000),
      })

      const text = await response.text()
      res.status(response.status)

      const contentType = response.headers.get('content-type')
      if (contentType) {
        res.set('Content-Type', contentType)
      }

      return res.send(text)
    } catch (error) {
      logger.error('Ollama proxy error:', { error })
      return res.status(502).json({
        error: 'Ollama proxy error',
        message: error.message,
      })
    }
  },
})
