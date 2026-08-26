const webpack = require('webpack')

const DEV_SERVER_PORT = Number(process.env.PORT) || 3000

module.exports = {
  productionSourceMap: false,
  css: { sourceMap: false },

  devServer: {
    host: 'localhost',
    port: DEV_SERVER_PORT,
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
    proxy: {
      '/ollama-proxy': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        pathRewrite: { '^/ollama-proxy': '' },
        timeout: 600000,
        proxyTimeout: 600000,
        onProxyReq(proxyReq, req) {
          console.log('[Ollama proxy] Solicitud:', req.method, req.url)
        },
        onProxyRes(proxyRes, req) {
          console.log('[Ollama proxy] Respuesta:', proxyRes.statusCode, req.url)
        },
        onError(error, req) {
          console.error('[Ollama proxy] Error:', {
            url: req.url,
            code: error.code,
            message: error.message,
          })
        },
      },
      '/storage-proxy': {
        target: 'https://firebasestorage.googleapis.com',
        changeOrigin: true,
        pathRewrite: { '^/storage-proxy': '' },
        onProxyReq(proxyReq) {
          proxyReq.setHeader('Referer', '')
        },
      },
    },
  },

  transpileDependencies: ['vuetify', 'resize-detector'],

  pluginOptions: {
    i18n: {
      locale: 'en',
      fallbackLocale: 'en',
      localeDir: 'locales',
      enableInSFC: true,
    },
  },

  configureWebpack: {
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser',
      }),

      new webpack.DefinePlugin({
        __VUE_OPTIONS_API__: JSON.stringify(true),
        __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
      }),
    ],
    resolve: {
      fallback: {
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer/'),
        process: require.resolve('process'),
        vm: false,
      },
    },
  },
}
