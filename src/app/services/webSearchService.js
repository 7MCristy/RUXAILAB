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
const READABILITY_MAX_CHARS = 4000 //
const WEB_RESEARCH_MAX_CHARS = 3000 // Límite para contenido web enviado a Ollama
const ADDITIONAL_URLS_TO_FETCH = 2 // Nº de URLs adicionales a leer con Readability
const ADDITIONAL_URL_MAX_CHARS = 1200 // Límite de contenido por URL adicional
const TOTAL_WEB_RESEARCH_MAX_CHARS = 4500 // Límite total tras combinar URL principal + adicionales

// Proxies CORS en orden de preferencia. Si uno falla 403, intenta el siguiente.
const CORS_PROXIES = [
  {
    name: 'corsfix',
    build: (url) => `https://corsfix.com/?${encodeURIComponent(url)}`,
  },
  {
    name: 'allorigins',
    build: (url) =>
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
  {
    name: 'corsproxy.io',
    build: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  },
  {
    name: 'r.jina.ai',
    build: (url) => `${JINA_READ_URL}/${encodeURIComponent(url)}`,
  },
]

const WEB_SEARCH_CONFIG = {
  skipReadability: false, // true = saltar Readability (local, sin tokens)
  skipJina: true, // true = saltar Jina AI (usa API key)
  skipTinyFish: false, // true = saltar TinyFish (usa API key)
}

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
 * Resume y limita el contenido web para enviar a Ollama.
 * Extrae la información más relevante y elimina ruido.
 * @param {string} content - Contenido extraído de la web
 * @param {number} maxChars - Máximo de caracteres
 * @returns {string} Contenido resumido y limpio
 */
function summarizeWebContent(content, maxChars = WEB_RESEARCH_MAX_CHARS) {
  if (!content) return ''

  // Eliminar líneas vacías múltiples y espacios extra
  let cleaned = content
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim()

  // Si ya es corto, devolver tal cual
  if (cleaned.length <= maxChars) {
    return cleaned
  }

  // Truncar y añadir indicador
  return (
    cleaned.substring(0, maxChars) +
    '\n[Contenido truncado por límite de tokens]'
  )
}

/**
 * Intenta fetch con un proxy CORS. Si falla con 403/429/5xx, lanza error para
 * que el caller pueda probar con otro proxy.
 */
async function fetchWithProxy(url, proxy) {
  const proxiedUrl = proxy.build(url)
  console.log(`[Readability] 🌐 Probando proxy ${proxy.name}:`, proxiedUrl)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(proxiedUrl, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    })
    clearTimeout(timeoutId)

    console.log(`[Readability] 📡 ${proxy.name} → HTTP ${response.status}`)

    if (!response.ok) {
      throw new Error(`Proxy ${proxy.name} HTTP ${response.status}`)
    }

    return await response.text()
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Extrae URLs de un contenido HTML, filtrando solo los enlaces del dominio objetivo
 * @param {string} html - Contenido HTML
 * @param {string} baseDomain - Dominio base para filtrar enlaces
 * @returns {string[]} Array de URLs encontradas
 */
function extractLinksFromHTML(html, baseDomain) {
  const urls = []
  // Parsear HTML simple para encontrar enlaces
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  const links = tempDiv.querySelectorAll('a[href]')
  for (const link of links) {
    const href = link.getAttribute('href')
    if (href && href.startsWith('http')) {
      try {
        const linkUrl = new URL(href)
        // Filtrar por dominio mismo o subdominios
        if (
          linkUrl.hostname === baseDomain ||
          linkUrl.hostname.endsWith('.' + baseDomain)
        ) {
          urls.push(href)
        }
      } catch (e) {
        // Ignorar enlaces mal formateados
      }
    }
  }
  // Devolver URLs únicas
  return [...new Set(urls)]
}

/**
 * Lee y extrae contenido limpio de una URL usando Readability (local).
 * Fetch raw HTML vía proxy CORS → DOMParser + @mozilla/readability.
 * Si un proxy falla (403, timeout, etc.), intenta con el siguiente.
 * Ahora incluye el proxy Jina AI (r.jina.ai) como opción adicional.
 *
 * @param {string} url - URL a leer
 * @returns {Promise<Object>} Objeto con title, excerpt, content y urls extraídas
 */
async function readWithReadability(url) {
  console.log('[Readability] 🔍 Iniciando lectura de:', url)

  let lastError = null

  for (const proxy of CORS_PROXIES) {
    try {
      const html = await fetchWithProxy(url, proxy)
      console.log(
        `[Readability] 📄 HTML recibido de ${proxy.name}:`,
        html.length,
        'chars',
      )

      // Verificar si el HTML parece el proxy en sí mismo (fallo común de corsfix)
      const lowerHtml = html.toLowerCase()
      const isCorsfixHtml =
        lowerHtml.includes('corsfix') || lowerHtml.includes('cross-origin')
      if (isCorsfixHtml) {
        console.warn(
          `[Readability] ⚠️ Proxy ${proxy.name} devolvió su propio contenido, saltando`,
        )
        throw new Error('Proxy returned own content')
      }

      const doc = new DOMParser().parseFromString(html, 'text/html')
      const article = new Readability(doc).parse()
      console.log(
        '[Readability] 📰 Artículo parseado:',
        article ? 'OK' : 'NULL',
      )

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

      // Intentar extraer URLs del contenido si es la primera extracción (dominio principal)
      let extractedUrls = []
      if (proxy.name !== 'r.jina.ai') {
        // No extraer URLs de Jina AI proxy para evitar duplicados
        try {
          const baseDomain = new URL(url).hostname
          extractedUrls = extractLinksFromHTML(html, baseDomain)
          // Mantener solo un número razonable de URLs
          extractedUrls = extractedUrls.slice(0, 5)
        } catch (e) {
          console.warn('[Readability] ⚠️ Error extrayendo URLs:', e.message)
        }
      }

      const result = {
        title,
        excerpt,
        content,
        urls: extractedUrls,
      }

      console.log(`[Readability] ✅ Éxito con proxy ${proxy.name}:`, {
        title,
        contentLength: content.length,
        urlsFound: extractedUrls.length,
      })

      return result
    } catch (error) {
      console.warn(`[Readability] ⚠️ Proxy ${proxy.name} falló:`, error.message)
      lastError = error
      // Continuar con el siguiente proxy
    }
  }

  // Todos los proxies fallaron
  console.error('[Readability] ❌ Todos los proxies fallaron')
  throw lastError || new Error('Todos los proxies CORS fallaron')
}

/**
 * Lee contenido adicional de hasta N URLs extraídas de la página principal,
 * reutilizando readWithReadability para cada una. Los fallos individuales
 * se ignoran (no bloquean la investigación web principal).
 *
 * @param {string[]} urls - URLs candidatas (normalmente las extraídas de la página principal)
 * @param {string} excludeUrl - URL a excluir (la ya leída como fuente principal)
 * @returns {Promise<string[]>} Bloques de texto, uno por URL leída con éxito
 */
async function readAdditionalUrls(urls = [], excludeUrl = '') {
  const targets = urls
    .filter((url) => url && url !== excludeUrl)
    .slice(0, ADDITIONAL_URLS_TO_FETCH)

  const sections = []
  for (const url of targets) {
    try {
      console.log('[Readability] 🔗 Leyendo URL adicional:', url)
      const extra = await readWithReadability(url)
      const summarized = summarizeWebContent(
        extra.content,
        ADDITIONAL_URL_MAX_CHARS,
      )
      trackTokens('readability', estimateTokens(summarized))
      sections.push(`--- ${extra.title || url} ---\n${summarized}`)
      console.log('[Readability] ✅ URL adicional leída:', {
        url,
        chars: summarized.length,
      })
    } catch (error) {
      console.warn(
        '[Readability] ⚠️ No se pudo leer URL adicional:',
        url,
        error.message,
      )
    }
  }
  return sections
}

function capContent(text, maxChars) {
  if (!text) return ''
  if (text.length <= maxChars) return text
  return (
    text.substring(0, maxChars) + '\n[Contenido truncado por límite de tokens]'
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
 * Para testear un proveedor específico, modifica WEB_SEARCH_CONFIG al inicio del archivo.
 *
 * @param {Object} options
 * @param {string} options.testUrl - URL del sitio a evaluar
 * @param {string} options.testDescription - Descripción del test
 * @param {string} options.testTitle - Título del test
 * @returns {Promise<{content: string, source: string}>}
 */
export async function researchWebsite({ testUrl, testDescription, testTitle }) {
  console.log('[WebSearch] 🚀 researchWebsite iniciado:', {
    testUrl,
    testDescription,
    testTitle,
  })
  console.log('[WebSearch] ⚙️ Configuración:', WEB_SEARCH_CONFIG)

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

  console.log('[WebSearch] 📋 Queries generadas:', uniqueQueries)

  // 0. Intentar Readability JS (local, sin tokens)
  if (!WEB_SEARCH_CONFIG.skipReadability && testUrl) {
    console.log('[WebSearch] 📖 testUrl disponible, intentando Readability...')
    try {
      console.log('[WebSearch] 📖 Intentando Readability JS para:', testUrl)
      const readableContent = await readWithReadability(testUrl)
      const summarized = summarizeWebContent(readableContent.content)
      trackTokens('readability', estimateTokens(summarized))
      // Incluir URLs extraídas en el contexto si las hay
      const urlsSection =
        readableContent.urls && readableContent.urls.length > 0
          ? `\n--- URLs extraídas del sitio ---\n${readableContent.urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`
          : ''
      allContent.push(
        `=== CONTEXTO DEL SITIO WEB ===\n${summarized}${urlsSection}`,
      )
      console.log('[WebSearch] ✅ Readability extrajo contenido:', {
        originalChars: readableContent.content.length,
        summarizedChars: summarized.length,
        tokens: estimateTokens(summarized),
        urlsFound: readableContent.urls.length,
      })

      // Leer 2 URLs adicionales extraídas del sitio para enriquecer el contexto
      if (readableContent.urls && readableContent.urls.length > 0) {
        const additionalSections = await readAdditionalUrls(
          readableContent.urls,
          testUrl,
        )
        if (additionalSections.length > 0) {
          allContent.push(
            `=== INFORMACIÓN DE PÁGINAS RELACIONADAS ===\n${additionalSections.join('\n\n')}`,
          )
          console.log('[WebSearch] ✅ URLs adicionales incorporadas:', {
            count: additionalSections.length,
          })
        }
      }

      const finalContent = capContent(
        allContent.join('\n\n'),
        TOTAL_WEB_RESEARCH_MAX_CHARS,
      )
      return { content: finalContent, source: 'readability' }
    } catch (readabilityError) {
      console.warn(
        '[WebSearch] ⚠️ Readability falló, continuando con Jina:',
        readabilityError.message,
      )
      // Intentar Jina AI directamente si Readability falló por proxy CORS
      if (readabilityError.message === 'Proxy returned own content') {
        console.log(
          '[WebSearch] 🔄 Readability falló por proxy CORS, intentando Jina AI directo...',
        )
        // Continuar al siguiente bloque Jina AI
      }
    }
  } else if (WEB_SEARCH_CONFIG.skipReadability) {
    console.log('[WebSearch] ⏭️ Readability deshabilitado por configuración')
  } else {
    console.log('[WebSearch] ⚠️ testUrl no disponible, saltando Readability')
  }

  // 1. Intentar Jina AI
  if (WEB_SEARCH_CONFIG.skipJina) {
    console.log('[WebSearch] ⏭️ Jina deshabilitado por configuración')
  } else if (!hasQuota('jina')) {
    console.warn('[WebSearch] ⚠️ Sin cuota de Jina disponible')
  } else {
    try {
      // Leer la URL del sitio evaluado directamente
      if (testUrl) {
        try {
          const siteContent = await readUrlWithJina(testUrl)
          const summarized = summarizeWebContent(siteContent)
          trackTokens('jina', estimateTokens(summarized))
          allContent.push(`=== CONTEXTO DEL SITIO WEB ===\n${summarized}`)
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
          const summarized = summarizeWebContent(searchResults)
          trackTokens('jina', estimateTokens(summarized))
          allContent.push(
            `=== INFORMACIÓN ADICIONAL: "${query}" ===\n${summarized}`,
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
  if (WEB_SEARCH_CONFIG.skipTinyFish) {
    console.log('[WebSearch] ⏭️ TinyFish deshabilitado por configuración')
  } else if (!hasQuota('tinyfish')) {
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
        const markdown = tinyFishResultsToMarkdown(tinyFishResults)
        const summarized = summarizeWebContent(markdown)
        return {
          content: summarized,
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
