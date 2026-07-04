import {
  hasQuota,
  trackTokens,
  estimateTokens,
  getRemaining,
} from './tokenTracker'

const JINA_SEARCH_URL = 'https://s.jina.ai'
const JINA_READ_URL = 'https://r.jina.ai'
const TINYFISH_SEARCH_URL = 'https://api.search.tinyfish.ai'

const TIMEOUT_MS = 25000

function getJinaApiKey() {
  return process.env.VUE_APP_JINA_API_KEY || ''
}

async function retryWithBackoff(
  fn,
  { retries = 2, baseDelay = 2000, label = '' } = {},
) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === retries) throw error
      const delay = baseDelay * Math.pow(2, attempt)
      console.warn(
        `[WebSearch] ⚠️ ${label} intento ${attempt + 1} falló, retry en ${delay}ms: ${error.message}`,
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/**
 * Busca en la web usando Jina AI (s.jina.ai)
 * @param {string} query - Consulta de búsqueda
 * @returns {Promise<string>} Contenido en markdown de los resultados
 */
async function searchWithJina(query) {
  return retryWithBackoff(
    async () => {
      const url = `${JINA_SEARCH_URL}/${encodeURIComponent(query)}`
      const headers = {
        Accept: 'text/markdown',
        'X-Return-Format': 'markdown',
      }
      const apiKey = getJinaApiKey()
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Jina search HTTP ${response.status}`)
        }

        return await response.text()
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    },
    { retries: 2, baseDelay: 2000, label: `Jina search: ${query.substring(0, 50)}` },
  )
}

/**
 * Lee el contenido de una URL usando Jina AI (r.jina.ai)
 * @param {string} url - URL a leer
 * @returns {Promise<string>} Contenido en markdown
 */
async function readUrlWithJina(url) {
  return retryWithBackoff(
    async () => {
      const fullUrl = `${JINA_READ_URL}/${encodeURIComponent(url)}`
      const headers = {
        Accept: 'text/markdown',
        'X-Return-Format': 'markdown',
      }
      const apiKey = getJinaApiKey()
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const response = await fetch(fullUrl, {
          headers,
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Jina read HTTP ${response.status}`)
        }

        return await response.text()
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    },
    { retries: 2, baseDelay: 2000, label: `Jina read: ${url.substring(0, 50)}` },
  )
}

/**
 * Busca en la web usando TinyFish
 * @param {string} query - Consulta de búsqueda
 * @returns {Promise<Array>} Resultados estructurados
 */
async function searchWithTinyFish(query) {
  return retryWithBackoff(
    async () => {
      const apiKey = process.env.VUE_APP_TINYFISH_API_KEY
      if (!apiKey) {
        throw new Error('TinyFish API key no configurada')
      }

      const url = `${TINYFISH_SEARCH_URL}?query=${encodeURIComponent(query)}`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const response = await fetch(url, {
          headers: {
            'X-API-Key': apiKey,
            Accept: 'application/json',
          },
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`TinyFish HTTP ${response.status}`)
        }

        const data = await response.json()
        return data?.results || []
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    },
    { retries: 1, baseDelay: 3000, label: `TinyFish: ${query.substring(0, 50)}` },
  )
}

/**
 * Convierte resultados de TinyFish a texto markdown
 */
function tinyFishResultsToMarkdown(results) {
  if (!results || !results.length) return 'No se encontraron resultados.'
  return results
    .map((r, i) => {
      return `### ${i + 1}. ${r.title || 'Sin título'}\n${r.snippet || r.description || ''}\nURL: ${r.url || ''}`
    })
    .join('\n\n')
}

/**
 * Investiga la web sobre el sitio evaluado.
 * Primario: Jina AI (search + read URL).
 * Fallback: TinyFish si Jina falla.
 *
 * @param {Object} options
 * @param {string} options.testUrl - URL del sitio a evaluar
 * @param {string} options.testDescription - Descripción del test
 * @param {string} options.testTitle - Título del test
 * @returns {Promise<{content: string, source: string}>}
 */
export async function researchWebsite({
  testUrl,
  testDescription,
  testTitle,
}) {
  const queries = []
  if (testUrl) {
    queries.push(`Análisis de usabilidad y UX de ${testUrl}`)
  }
  if (testDescription) {
    queries.push(`${testDescription} evaluación heurística usabilidad`)
  }
  if (testTitle) {
    queries.push(`${testTitle} review UX usability analysis`)
  }

  const uniqueQueries = [...new Set(queries.filter(Boolean))]
  const allContent = []

  // 1. Intentar Jina AI
  if (!hasQuota('jina')) {
    // Sin cuota, saltar a TinyFish
  } else {
    try {
      // Leer la URL del sitio evaluado directamente
      if (testUrl) {
        try {
          const siteContent = await readUrlWithJina(testUrl)
          trackTokens('jina', estimateTokens(siteContent))
          allContent.push(
            `=== CONTENIDO DEL SITIO EVALUADO (${testUrl}) ===\n${siteContent}`,
          )
        } catch (readError) {
          console.error('[WebSearch] Jina read failed for URL:', testUrl, readError)
        }
      }

      // Buscar información relevante
      for (const query of uniqueQueries.slice(0, 2)) {
        if (!hasQuota('jina')) break
        try {
          const searchResults = await searchWithJina(query)
          trackTokens('jina', estimateTokens(searchResults))
          allContent.push(
            `=== RESULTADOS DE BÚSQUEDA: "${query}" ===\n${searchResults}`,
          )
        } catch (searchError) {
          console.error('[WebSearch] Jina search failed for query:', query, searchError)
        }
      }

      if (allContent.length > 0) {
        return { content: allContent.join('\n\n'), source: 'jina' }
      }
    } catch (jinaError) {
      console.error('[WebSearch] Jina search/read failed:', jinaError)
    }
  }

  // 2. Fallback: TinyFish
  try {
    const tinyFishResults = []
    for (const query of uniqueQueries.slice(0, 1)) {
      try {
        const results = await searchWithTinyFish(query)
        tinyFishResults.push(...results)
      } catch (tfError) {
        console.error('[WebSearch] TinyFish search failed for query:', query, tfError)
      }
    }

    if (tinyFishResults.length > 0) {
      return { content: tinyFishResultsToMarkdown(tinyFishResults), source: 'tinyfish' }
    }
  } catch (tinyFishError) {
    console.error('[WebSearch] TinyFish search failed:', tinyFishError)
  }

  // 3. Sin resultados
  return { content: '', source: 'none' }
}

export default {
  researchWebsite,
}
