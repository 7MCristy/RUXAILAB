import {
  hasQuota,
  trackTokens,
  estimateTokens,
  getRemaining,
} from './tokenTracker'
import { Readability } from '@mozilla/readability'

const JINA_SEARCH_URL = 'https://s.jina.ai'
const JINA_READ_URL = 'https://r.jina.ai'
const TINYFISH_SEARCH_URL = 'https://api.search.tinyfish.ai'

const TIMEOUT_MS = 25000
const READABILITY_MAX_CHARS = 4000
const CORS_PROXY_URL =
  process.env.VUE_APP_CORS_PROXY_URL || 'https://corsproxy.io/?'

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
 * Lee y extrae contenido limpio de una URL usando Readability (local).
 * Fetch raw HTML vía proxy CORS → JSDOM + @mozilla/readability.
 *
 * @param {string} url - URL a leer
 * @returns {Promise<string>} Contenido limpio en texto plano (truncado a READABILITY_MAX_CHARS)
 */
async function readWithReadability(url) {
  return retryWithBackoff(
    async () => {
      const proxiedUrl = `${CORS_PROXY_URL}${encodeURIComponent(url)}`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const response = await fetch(proxiedUrl, {
          signal: controller.signal,
          headers: { Accept: 'text/html' },
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Readability proxy HTTP ${response.status}`)
        }

        const html = await response.text()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const article = new Readability(doc).parse()

        if (!article || !article.textContent) {
          throw new Error('Readability no pudo extraer contenido')
        }

        const content = article.textContent
          .substring(0, READABILITY_MAX_CHARS)
          .trim()

        if (content.length < 50) {
          throw new Error('Readability extrae contenido demasiado corto')
        }

        const title = article.title || ''
        const excerpt = article.excerpt || ''
        const result = [
          title ? `Título: ${title}` : '',
          excerpt ? `Resumen: ${excerpt}` : '',
          content,
        ]
          .filter(Boolean)
          .join('\n')

        return result
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    },
    {
      retries: 2,
      baseDelay: 2000,
      label: `Readability: ${url.substring(0, 50)}`,
    },
  )
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
    {
      retries: 2,
      baseDelay: 2000,
      label: `Jina search: ${query.substring(0, 50)}`,
    },
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
    {
      retries: 2,
      baseDelay: 2000,
      label: `Jina read: ${url.substring(0, 50)}`,
    },
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
      const startedAt = Date.now()

      console.log('[TinyFish] Iniciando búsqueda:', {
        query: query.substring(0, 80),
        apiKeyConfigured: Boolean(apiKey),
      })

      if (!apiKey) {
        console.error('[TinyFish] API key no configurada')
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

        console.log('[TinyFish] Respuesta HTTP:', {
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - startedAt,
        })

        if (!response.ok) {
          const errorBody = (await response.text()).slice(0, 300)
          console.error('[TinyFish] Cuerpo de error:', errorBody)
          throw new Error(
            `TinyFish HTTP ${response.status}${errorBody ? ` - ${errorBody}` : ''}`,
          )
        }

        const data = await response.json()
        const results = Array.isArray(data?.results) ? data.results : []
        console.log('[TinyFish] Búsqueda completada:', {
          resultCount: results.length,
          responseKeys: Object.keys(data || {}),
          durationMs: Date.now() - startedAt,
        })
        return results
      } catch (error) {
        clearTimeout(timeoutId)
        console.error('[TinyFish] Error en la búsqueda:', {
          name: error?.name,
          message: error?.message,
          durationMs: Date.now() - startedAt,
        })
        throw error
      }
    },
    {
      retries: 1,
      baseDelay: 3000,
      label: `TinyFish: ${query.substring(0, 50)}`,
    },
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
 * Prioridad: Readability JS (local, 0 tokens) → Jina AI → TinyFish.
 *
 * @param {Object} options
 * @param {string} options.testUrl - URL del sitio a evaluar
 * @param {string} options.testDescription - Descripción del test
 * @param {string} options.testTitle - Título del test
 * @returns {Promise<{content: string, source: string}>}
 */
export async function researchWebsite({ testUrl, testDescription, testTitle }) {
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

  // 0. Intentar Readability JS (local, sin tokens)
  if (testUrl) {
    try {
      console.log('[WebSearch] 📖 Intentando Readability JS para:', testUrl)
      const readableContent = await readWithReadability(testUrl)
      trackTokens('readability', estimateTokens(readableContent))
      allContent.push(
        `=== CONTENIDO DEL SITIO EVALUADO (${testUrl}) ===\n${readableContent}`,
      )
      console.log('[WebSearch] ✅ Readability extrajo contenido:', {
        chars: readableContent.length,
        tokens: estimateTokens(readableContent),
      })
      return { content: allContent.join('\n\n'), source: 'readability' }
    } catch (readabilityError) {
      console.warn(
        '[WebSearch] ⚠️ Readability falló, continuando con Jina:',
        readabilityError.message,
      )
    }
  }

  // 1. Intentar Jina AI
  if (!hasQuota('jina')) {
    console.warn('[WebSearch] ⚠️ Sin cuota de Jina disponible')
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
          console.error(
            '[WebSearch] Jina read failed for URL:',
            testUrl,
            readError,
          )
          trackTokens('jina', estimateTokens(testUrl))
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
          console.error(
            '[WebSearch] Jina search failed for query:',
            query,
            searchError,
          )
          trackTokens('jina', estimateTokens(query))
        }
      }

      if (allContent.length > 0) {
        return { content: allContent.join('\n\n'), source: 'jina' }
      }
    } catch (jinaError) {
      console.error('[WebSearch] Jina search/read failed:', jinaError)
      trackTokens('jina', estimateTokens(uniqueQueries[0] || ''))
      console.warn('[WebSearch] 🔄 Jina falló, usando TinyFish como fallback')
    }
  }

  // 2. Fallback: TinyFish
  if (!hasQuota('tinyfish')) {
    console.warn('[WebSearch] ⚠️ Sin cuota de TinyFish disponible')
  } else {
    console.log('[TinyFish] Disponible como fallback:', {
      queriesToProcess: uniqueQueries.slice(0, 1).length,
      remainingTokens: getRemaining('tinyfish').remaining,
    })
    try {
      const tinyFishResults = []
      for (const query of uniqueQueries.slice(0, 1)) {
        if (!hasQuota('tinyfish')) break
        try {
          const results = await searchWithTinyFish(query)
          trackTokens('tinyfish', estimateTokens(JSON.stringify(results)))
          tinyFishResults.push(...results)
          console.log('[TinyFish] Resultados acumulados:', {
            resultCount: tinyFishResults.length,
          })
        } catch (tfError) {
          console.error(
            '[WebSearch] TinyFish search failed for query:',
            query,
            tfError,
          )
          trackTokens('tinyfish', estimateTokens(query))
        }
      }

      if (tinyFishResults.length > 0) {
        console.log('[TinyFish] Investigación completada correctamente:', {
          resultCount: tinyFishResults.length,
        })
        return {
          content: tinyFishResultsToMarkdown(tinyFishResults),
          source: 'tinyfish',
        }
      }

      console.warn('[TinyFish] La petición terminó sin resultados')
    } catch (tinyFishError) {
      console.error('[WebSearch] TinyFish search failed:', tinyFishError)
      trackTokens('tinyfish', estimateTokens(uniqueQueries[0] || ''))
    }
  }

  // 3. Sin resultados - todos los servicios agotados
  const jinaExhausted = !hasQuota('jina')
  const tinyfishExhausted = !hasQuota('tinyfish')

  if (jinaExhausted && tinyfishExhausted) {
    console.warn(
      '[WebSearch] ⚠️ Cuota agotada en Jina y TinyFish. Readability no obtuvo contenido. No hay más fuentes disponibles.',
    )
    return {
      content: '',
      source: 'none',
      message:
        'No quedan fuentes disponibles para investigación web (Readability, Jina y TinyFish agotados).',
    }
  }

  return { content: '', source: 'none', message: '' }
}

export default {
  researchWebsite,
}
