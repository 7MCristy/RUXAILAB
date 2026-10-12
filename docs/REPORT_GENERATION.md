# Generación de informes de evaluación heurística con IA

Documentación de arquitectura del sistema que genera el PDF del informe
de evaluación heurística, con síntesis narrativa opcional mediante IA
(Gemini en la nube, con Ollama local como respaldo). Describe el estado
**actual** del código tras la reestructuración de este TFG — sustituye en
este aspecto a `docs/INFORME.md`, que describe una versión anterior y ya
desactualizada de estos mismos ficheros (p.ej. sigue hablando de
`pdfGeneratorWithAi.js` como fichero independiente de 2036 líneas, cuando
hoy es un *shim* de 17 líneas, y no menciona el proveedor Ollama).

## 1. Visión general

El informe se genera en dos fases independientes:

1. **Datos y estadísticas** (siempre, sin IA): se calculan los
   porcentajes de cumplimiento, desviaciones típicas, warnings y
   evidencia por heurística a partir de las respuestas de los
   evaluadores.
2. **Síntesis narrativa con IA** (opcional): un LLM redacta la
   introducción, el análisis por heurística, la comparativa y la
   conclusión en prosa, a partir de esos mismos datos. Si la IA falla o
   no está disponible, el PDF usa sus propios textos de respaldo
   generados por reglas.

Ambas fases alimentan el mismo motor de renderizado de PDF
(`pdfGenerator.js`), que es idéntico se use IA o no.

## 2. Flujo de datos de extremo a extremo

```
FinalReportSelectionBox.vue (UI)
        │
        │ construye finalReportItem (título, testStructure, allAnswers,
        │ estadísticas ya calculadas por statistics.js...)
        ▼
generateAiReportWithFallback()          ← geminiReportService.js (orquestador)
        │
        ├─ 1er eslabón: Gemini ──────── geminiProvider.js
        │     │                              │
        │     │                     buildHeuristicReportPrompt() ← aiReportPrompt.js
        │     │                              │
        │     │                   prepareReportData() ← promptDataHelpers.js
        │     │                              │
        │     │              buildHeuristicEvidence() + researchWebsite()
        │     │
        │     └─ respuesta JSON → parseGeminiJsonSections() (interno a geminiProvider.js)
        │
        ├─ 2º eslabón (si falla/sin cuota Gemini): Ollama ── ollamaProvider.js
        │     │
        │     │                   buildOllamaPlan() ← aiReportPromptOllama.js
        │     │                              │
        │     │                   prepareReportData() ← promptDataHelpers.js (la MISMA función)
        │     │
        │     └─ respuestas de texto → assembleOllamaReport() ← ollamaResponseParser.js
        │
        └─ 3er eslabón (si ambas fallan): secciones vacías
                   │
                   ▼
        resultado = { content, sections, source }
        │
        ▼
generateHeuristicPdf(reportData)        ← pdfGenerator.js
        │
        └─ usa createPdfLayout() ← pdf/layout.js  (paginación, párrafos, tablas)
                   │
                   ▼
              informe.pdf
```

## 3. Estructura de ficheros

### 3.1 Orquestación y proveedores de IA — `src/app/services/`

| Fichero | Líneas | Responsabilidad | Funciones exportadas |
|---|---:|---|---|
| `geminiReportService.js` | ~165 | Orquestador: cadena de responsabilidad Gemini → Ollama → vacío. No sabe nada de cómo habla cada proveedor con su API. | `generateAiReportWithFallback()`, `useAiReport()`, más re-exports de los proveedores para no romper imports externos |
| `ai/geminiProvider.js` | ~495 | Todo lo específico de la API oficial de Gemini (`@google/genai`): cliente, esquema JSON forzado, reintentos ante 429/503, parseo de la respuesta JSON | `generateAiReportWithGemini()`, `correctCommentsWithAI()`, `testGeminiConnection()`, `isGeminiConfigured()` |
| `ai/ollamaProvider.js` | ~320 | Todo lo específico del fallback local: comprobación de disponibilidad, pool de llamadas en paralelo (máx. 3 a la vez, con reintentos) | `generateAiReportWithOllama()` |
| `ai/aiReportParsers.js` | ~360 | Parseo de texto libre en las 6 secciones del informe (delimitadores `===SECCION:X===` → headers `## X` → keywords), usado como respaldo cuando un proveedor no devuelve ya secciones estructuradas | `parseAiReportSections()`, `parseHeuristicAnalysis()` |
| `ai/aiConfig.js` | ~35 | Variables de entorno centralizadas (modelo, timeouts, flag de investigación web) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT`, `OLLAMA_TIMEOUT_MS`, `ENABLE_WEB_RESEARCH`, `normalizeGeminiModel()` |
| `webSearchService.js` | ~500 | Investigación web (RAG) sobre el sitio evaluado: Readability.js local (gratis) → Jina AI → TinyFish, en cascada | `researchWebsite()` |
| `tokenTracker.js` | ~150 | Control de cuota de Gemini/Jina en `localStorage` | `hasQuota()`, `trackTokens()`, `estimateTokens()`, `getRemaining()`, `getAiContext()`, `setAiContext()`, `clearAiContext()`, `resetUsage()` |

**Patrones aplicados**: *Strategy* (cada proveedor es intercambiable, mismo contrato de entrada/salida) + *Chain of Responsibility* (el orquestador decide el orden y qué hacer si un eslabón falla, sin que los proveedores se conozcan entre sí).

### 3.2 Construcción de prompts y preparación de datos — `src/ux/Heuristic/utils/`

| Fichero | Líneas | Responsabilidad | Funciones exportadas |
|---|---:|---|---|
| `aiReportPrompt.js` | ~316 | Redacción del prompt para **Gemini** (JSON forzado) | `SYSTEM_PROMPT`, `buildHeuristicReportPrompt()` |
| `aiReportPromptOllama.js` | ~309 | Redacción del plan de llamadas para **Ollama/Qwen** (varias peticiones pequeñas: intro+porcentajes, N lotes de heurísticas, conclusión) | `buildOllamaPlan()` |
| `promptDataHelpers.js` | ~432 | Preparación de datos **compartida** por ambos: estadísticas, evidencia, clasificación por severidad, textos auxiliares. Único lugar donde se calculan estos valores | `prepareReportData()`, `sectionMarker()`, `classifyHeuristics()`, `buildHeuristicDetailData()`, `buildHeuristicsDetailText()`, `formatEvaluatorsSummary()`, `getQuestionSummaries()`, `toFiniteNumber()` |
| `nielsenTognazziniDetector.js` | ~72 | Detecta si las heurísticas del test coinciden con las 15 de Nielsen + Tognazzini (autocontenido, sin relación con la redacción del prompt) | `detectNielsenTognazziniMethodology()` |
| `ollamaResponseParser.js` | ~520 | Parseo y ensamblaje de lo que Ollama responde: bloques `H{n}/[ETIQUETA]`, fallback por lista numerada, separación intro/porcentajes | `parseHeuristicBlocksGeneric()`, `parseOllamaHeuristicBatch()`, `parseIntroPorcentajes()`, `assembleOllamaReport()` |

**Patrón aplicado**: *Template Method* — `prepareReportData()` es el "paso fijo" del algoritmo (igual para cualquier proveedor); lo que varía por proveedor es solo la redacción final del texto del prompt, que queda en cada fichero por separado porque está afinada empíricamente por modelo (forzarla a ser idéntica degradaría la calidad de uno de los dos informes).

### 3.3 Generación del PDF — `src/ux/Heuristic/utils/`

| Fichero | Líneas | Responsabilidad | Funciones exportadas |
|---|---:|---|---|
| `pdfGenerator.js` | ~1805 | Motor de renderizado: portada, índice, 6 secciones con tablas (`jspdf-autotable`), imágenes embebidas | `generateHeuristicPdf()` (función principal, ~1300 líneas), `generateHeuristicPdfWithAi` (alias), más ~15 helpers de formato específicos del PDF (colores de celda, severidad cualitativa, impacto positivo/negativo...) |
| `pdf/layout.js` | ~140 | *Builder* de paginación: cabecera/pie, salto de página, títulos de sección (con entrada automática al índice), párrafos justificados | `createPdfLayout()`, `addFooter()` |
| `pdf/constants.js` | ~33 | Constantes de layout y color (márgenes, tamaño de página, paleta) | `FONT`, `M`, `PAGE_W`, `PAGE_H`, `CONTENT_W`, `LH`, `COLORS`, `SEVERITY_COLORS` |
| `pdfGeneratorWithAi.js` | 17 | *Shim* de compatibilidad: re-exporta `generateHeuristicPdf` bajo el nombre antiguo, para no romper imports existentes | — |

**Patrón aplicado**: *Builder* — `createPdfLayout(doc, state, testTitle)` encapsula la lógica de "cuándo saltar de página y cómo dibujar un título/párrafo", y `generateHeuristicPdf()` solo decide **qué** contenido va en cada sección, delegando el **cómo** maquetarlo.

### 3.4 Utilidades compartidas — `src/ux/Heuristic/utils/`

| Fichero | Responsabilidad | Funciones clave |
|---|---|---|
| `reportHelpers.js` | Formato de texto puro, sin dependencias de jsPDF ni de Firestore: strip de HTML/Markdown, normalización, parsing numérico | `stripHtml()`, `stripMarkdown()`, `normalizeText()`, `getNumber()`, `normalizeForFuzzyMatch()` |
| `statistics.js` | Cálculo estadístico: porcentajes, desviación típica, 3 escenarios de warnings, severidad | `calcFinalResult()`, `standardDeviation()`, `getSeverityLabel()`, `buildHeuristicsStatistics()`, `buildEvaluatorPercentages()` |
| `buildHeuristicEvidence.js` | Transforma las respuestas crudas de Firestore en evidencia por heurística (medias, warnings, comentarios, imágenes) — la capa de datos que consumen tanto el PDF como los prompts de IA | `buildHeuristicEvidence()`, `findHeuristicComments()` |

Estos tres ficheros no dependen unos de otros en ciclo — antes `buildHeuristicEvidence.js` importaba helpers de vuelta desde `pdfGenerator.js` (dependencia circular), ahora todo pasa por `reportHelpers.js`/`statistics.js`.

### 3.5 Interfaz de usuario — `src/ux/Heuristic/components/`

| Fichero | Responsabilidad |
|---|---|
| `final_report/FinalReportSelectionBox.vue` | Configura y dispara la generación: decide si se pide síntesis con IA, llama a `generateAiReportWithFallback()` y después a `generateHeuristicPdf()`, muestra el estado de cuota de Gemini/Ollama |
| `statistics/StatisticsSummaryCard.vue` | Tarjeta resumen en pantalla (no en el PDF): promedio global, panel de warnings, imágenes por heurística, cobertura de la evaluación, distribución de tipos de respuesta |

## 4. Resumen de patrones de diseño aplicados

| Patrón | Dónde | Por qué |
|---|---|---|
| **Strategy** | `geminiProvider.js` / `ollamaProvider.js` | Proveedores de IA intercambiables con el mismo contrato de entrada/salida |
| **Chain of Responsibility** | `generateAiReportWithFallback()` en `geminiReportService.js` | Cadena Gemini → Ollama → vacío, cada eslabón decide si pasa al siguiente |
| **Template Method** | `prepareReportData()` en `promptDataHelpers.js` | Paso de datos fijo y compartido; solo la redacción final varía por proveedor |
| **Builder** | `createPdfLayout()` en `pdf/layout.js` | Encapsula el "cómo" de la paginación, separado del "qué" del contenido |

## 5. Verificación realizada durante la reestructuración

- **Tests unitarios**: 145/147 pasan (los 2 que fallan son un bug preexistente en una aserción de test, no relacionado con estos cambios).
- **Compilación**: sin errores nuevos de webpack tras cada fase.
- **PDF**: se generó un informe con datos de prueba antes y después de extraer el *Builder* de `pdfGenerator.js`; los dos ficheros resultantes son **idénticos byte a byte** salvo el identificador aleatorio que jsPDF asigna en cada `.save()`.
