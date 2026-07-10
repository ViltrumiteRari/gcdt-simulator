import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('realReplayDataJul10')) return 'replay-july10'
          if (id.includes('realReplayData.js')) return 'replay-core'
        },
      },
    },
  },
})
