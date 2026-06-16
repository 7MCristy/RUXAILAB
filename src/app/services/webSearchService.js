const JINA_SEARCH_URL = 'https://s.jina.ai'
const JINA_READ_URL = 'https://r.jina.ai'
const TINYFISH_SEARCH_URL = 'https://api.search.tinyfish.ai'

const TIMEOUT_MS = 15000

function getJinaApiKey() {
  return process.env.VUE_APP_JINA_API_KEY || ''
}

/**
 * Busca en la web usando Jina AI (s.jina.ai)
 * @param {string} query - Consulta de búsqueda
 * @returns {Promise<string>} Contenido en markdown de los resultados
 */
async function searchWithJina(query) {
  const url = `${JINA_SEARCH_URL}/${encodeURIComponent(query)}`
  const headers = {
    'Accept': 'text/markdown',
    'X-Return-Format': 'markdown',
  }
  const apiKey = getJinaApiKey()
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  console.log('[WebSearch] 🔍 Buscando con Jina AI:', query.substring(0, 100))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Jina search HTTP ${response.status}`)
    }

    const text = await response.text()
    console.log('[WebSearch] ✅ Jina AI respondió, longitud:', text.length)
    return text
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Lee el contenido de una URL usando Jina AI (r.jina.ai)
 * @param {string} url - URL a leer
 * @returns {Promise<string>} Contenido en markdown
 */
async function readUrlWithJina(url) {
  const fullUrl = `${JINA_READ_URL}/${encodeURIComponent(url)}`
  const headers = {
    'Accept': 'text/markdown',
    'X-Return-Format': 'markdown',
  }
  const apiKey = getJinaApiKey()
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  console.log('[WebSearch] 📖 Leyendo URL con Jina AI:', url)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(fullUrl, { headers, signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Jina read HTTP ${response.status}`)
    }

    const text = await response.text()
    console.log('[WebSearch] ✅ URL leída, longitud:', text.length)
    return text
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Busca en la web usando TinyFish
 * @param {string} query - Consulta de búsqueda
 * @returns {Promise<Array>} Resultados estructurados
 */
async function searchWithTinyFish(query) {
  const apiKey = process.env.VUE_APP_TINYFISH_API_KEY
  if (!apiKey) {
    throw new Error('TinyFish API key no configurada')
  }

  const url = `${TINYFISH_SEARCH_URL}?q=${encodeURIComponent(query)}`
  console.log('[WebSearch] 🔍 Buscando con TinyFish:', query.substring(0, 100))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`TinyFish HTTP ${response.status}`)
    }

    const data = await response.json()
    console.log('[WebSearch] ✅ TinyFish respondió, resultados:', data?.results?.length || 0)
    return data?.results || []
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
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
export async function researchWebsite({ testUrl, testDescription, testTitle }) {
  console.log('[WebSearch] ===== INICIO INVESTIGACIÓN WEB =====')
  console.log('[WebSearch] URL:', testUrl)
  console.log('[WebSearch] Descripción:', testDescription?.substring(0, 100))

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
  try {
    console.log('[WebSearch] 🚀 Usando Jina AI...')

    // Leer la URL del sitio evaluado directamente
    if (testUrl) {
      try {
        const siteContent = await readUrlWithJina(testUrl)
        allContent.push(`=== CONTENIDO DEL SITIO EVALUADO (${testUrl}) ===\n${siteContent}`)
      } catch (readError) {
        console.warn('[WebSearch] ⚠️ No se pudo leer la URL con Jina:', readError.message)
      }
    }

    // Buscar información relevante
    for (const query of uniqueQueries.slice(0, 2)) {
      try {
        const searchResults = await searchWithJina(query)
        allContent.push(`=== RESULTADOS DE BÚSQUEDA: "${query}" ===\n${searchResults}`)
      } catch (searchError) {
        console.warn('[WebSearch] ⚠️ Búsqueda Jina falló:', searchError.message)
      }
    }

    if (allContent.length > 0) {
      const combined = allContent.join('\n\n')
      console.log('[WebSearch] ✅ Investigación web completada con Jina AI, total:', combined.length, 'caracteres')
      console.log('[WebSearch] ===== FIN INVESTIGACIÓN WEB (Jina) =====')
      return { content: combined, source: 'jina' }
    }
  } catch (jinaError) {
    console.warn('[WebSearch] ⚠️ Jina AI falló completamente:', jinaError.message)
  }

  // 2. Fallback: TinyFish
  try {
    console.log('[WebSearch] 🔄 Intentando TinyFish como fallback...')

    const tinyFishResults = []
    for (const query of uniqueQueries.slice(0, 1)) {
      try {
        const results = await searchWithTinyFish(query)
        tinyFishResults.push(...results)
      } catch (tfError) {
        console.warn('[WebSearch] ⚠️ TinyFish falló:', tfError.message)
      }
    }

    if (tinyFishResults.length > 0) {
      const markdown = tinyFishResultsToMarkdown(tinyFishResults)
      console.log('[WebSearch] ✅ Investigación web completada con TinyFish')
      console.log('[WebSearch] ===== FIN INVESTIGACIÓN WEB (TinyFish) =====')
      return { content: markdown, source: 'tinyfish' }
    }
  } catch (tinyFishError) {
    console.warn('[WebSearch] ⚠️ TinyFish también falló:', tinyFishError.message)
  }

  // 3. Sin resultados
  console.log('[WebSearch] ⚠️ No se pudo obtener investigación web')
  console.log('[WebSearch] ===== FIN INVESTIGACIÓN WEB (sin datos) =====')
  return { content: '', source: 'none' }
}

export default {
  researchWebsite,
}
