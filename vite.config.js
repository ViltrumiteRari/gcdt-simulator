import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { GoogleGenAI } from '@google/genai'

function localLiveTokenPlugin(env) {
  return {
    name: 'firstsignal-local-live-token',
    configureServer(server) {
      server.middlewares.use('/api/live-token', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')
          const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1alpha' } })
          const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString()
          const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString()
          const token = await ai.authTokens.create({ config: { uses: 1, expireTime, newSessionExpireTime, httpOptions: { apiVersion: 'v1alpha' } } })
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify({ token: token.name, expiresAt: expireTime }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'LIVE_TOKEN_FAILURE', message: String(error?.message || error) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), localLiveTokenPlugin(env)],
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
  }
})
