import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createPriceChartingHandler } from './server/pricecharting.js'

function priceChartingPlugin() {
  const handler = createPriceChartingHandler()

  return {
    name: 'pricecharting-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), priceChartingPlugin()],
})
