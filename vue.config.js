const webpack = require('webpack')

module.exports = {
  productionSourceMap: false,
  css: { sourceMap: false },

  devServer: {
    proxy: {
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

  transpileDependencies: [
    'vuetify',
    'resize-detector',
  ],

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
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false)
      }),
    ],
    resolve: {
      fallback: {
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer/'),
        process: require.resolve('process'),
        "vm": false,

      },
    },
  },
};
