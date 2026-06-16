import { createApp } from 'vue';
import App from './app/App.vue';
import router from './app/router/index.js';
import store from './store';
import vuetify from './app/plugins/vuetify.js';
import i18n from './app/plugins/i18n';
import Toast, { useToast } from 'vue-toastification';
import TextClamp from 'vue3-text-clamp';
import { quillEditor } from 'vue3-quill'
import 'vue-toastification/dist/index.css';
import '@vueup/vue-quill/dist/vue-quill.snow.css'

const app = createApp(App);

const options = {
  newestOnTop: true,
  position: 'top-right',
  draggable: true,
  pauseOnHover: true,
  closeOnClick: true,
  timeout: 4000,
};

// Use plugins
app.use(router);
app.use(store);
app.use(vuetify);
app.use(i18n);
app.use(Toast, options);
app.use(TextClamp);
app.use(quillEditor)

app.config.globalProperties.$toast = useToast();

// ─── Parche anti-errores de extensiones Chrome ──────────────────────────────
// Suprime errores de extensiones que usan chrome.runtime (no afectan a la app)
const CHROME_ERROR_PATTERNS = [
  'message channel closed',
  'listener indicated an asynchronous response',
  'Extension context invalidated',
  'runtime.lastError',
]

function isChromeExtensionError(msg) {
  if (!msg || typeof msg !== 'string') return false
  return CHROME_ERROR_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()))
}

// Handler para promesas rechazadas no capturadas
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || event.reason?.toString() || ''
  if (isChromeExtensionError(msg)) {
    console.warn(
      '[App] ⚠️ Suprimido error de extensión Chrome (promesa):',
      msg.substring(0, 120),
    )
    event.preventDefault()
  }
})

// Handler para errores síncronos no capturados
window.addEventListener('error', (event) => {
  const msg = event.error?.message || event.message || ''
  if (isChromeExtensionError(msg)) {
    console.warn(
      '[App] ⚠️ Suprimido error de extensión Chrome (síncrono):',
      msg.substring(0, 120),
    )
    event.preventDefault()
  }
})

// Parchea chrome.runtime si existe (suprime Unchecked runtime.lastError)
try {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    const apisToPatch = ['sendMessage', 'connect']
    for (const apiName of apisToPatch) {
      const original = chrome.runtime[apiName]
      if (typeof original === 'function') {
        chrome.runtime[apiName] = function (...args) {
          const lastIdx = args.length - 1
          if (typeof args[lastIdx] === 'function') {
            const origCallback = args[lastIdx]
            args[lastIdx] = function (...cbArgs) {
              try {
                if (chrome.runtime.lastError) {
                  // Silencia el error de runtime.lastError
                  return
                }
              } catch (e) {
                // ignore
              }
              return origCallback.apply(this, cbArgs)
            }
          }
          return original.apply(chrome.runtime, args)
        }
      }
    }
  }
} catch (e) {
  // chrome no disponible o en modo restringido
}

// ─── FIN parche ─────────────────────────────────────────────────────────────

// Mount the app
app.mount('#app');
