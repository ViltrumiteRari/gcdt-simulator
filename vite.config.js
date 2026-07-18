import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { GoogleGenAI } from '@google/genai'
import fs from 'node:fs'
import path from 'node:path'

function readTraderLearningPacket() {
  const file = path.resolve(process.cwd(), 'knowledge-pipeline', '03-findings', 'canonical-findings.json')
  let data = { findings: {} }
  try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch {}
  const allowed = new Set(['VALIDATED','FIX_VERIFIED','FIXED_PENDING_VALIDATION','PARTIALLY_VALIDATED'])
  const items = Object.values(data.findings || {})
    .filter(item => allowed.has(item.lifecycleStatus))
    .sort((a, b) => String(b.lastSeen || b.updatedAt || '').localeCompare(String(a.lastSeen || a.updatedAt || '')))
    .slice(0, 24)
    .map(item => ({
      rootCauseKey: item.rootCauseKey || item.key,
      title: item.title || item.rootCauseKey || item.key,
      status: item.lifecycleStatus,
      summary: item.latestSummary || item.summary || item.adjudicationNote || '',
      adjudicationNote: item.adjudicationNote || '',
      latestBuildId: item.latestBuildId || item.fixes?.at(-1)?.buildId || item.validations?.at(-1)?.buildId || null,
      validatedAtUtc: item.validations?.at(-1)?.validatedAtUtc || item.decidedAt || null,
      fixedAtUtc: item.fixes?.at(-1)?.implementedAtUtc || null,
    }))
  const memoryFile = path.resolve(process.cwd(), 'knowledge-pipeline', '04-memory', 'compounding-memory.json')
  let memory = { memories: [] }
  try { memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8').replace(/^\uFEFF/, '')) } catch {}
  const compounding = (memory.memories || []).filter(item => item.status === 'ACTIVE').map(item => ({
    kind: 'COMPOUNDING_MEMORY', id: item.id, title: item.title, status: item.status,
    knowledgeCutoffTick: item.knowledgeCutoffTick, sessionMinute: item.sessionMinute,
    thesisScope: item.thesisScope, state: item.state, interpretation: item.interpretation,
    usePolicy: item.usePolicy, confidence: item.confidence, evidenceCount: item.evidenceCount
  }))
  return { pipelineVersion: 3, generatedAtUtc: new Date().toISOString(), items, compounding }
}

function localLiveTokenPlugin(env) {
  return {
    name: 'firstsignal-local-live-token',
    configureServer(server) {
      server.middlewares.use('/api/trader-learning', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(readTraderLearningPacket()))
      })
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
    server: {
      watch: {
        ignored: [
          '**/runtime/**',
          '**/knowledge-pipeline/parallel/**',
          '**/logs/**',
        ],
      },
    },
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
