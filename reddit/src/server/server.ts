// Routes every request. Player endpoints are under /api/ (called from the
// web view); Reddit calls the /internal/ ones for menus, forms, scheduled jobs
// and triggers.
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as admin from './admin.ts'
import * as game from './game.ts'

type Handler = (body: any, url: URL) => Promise<unknown>

const routes: Record<string, { method: 'GET' | 'POST'; run: Handler }> = {
  '/api/init': { method: 'GET', run: () => game.init() },
  '/api/splash': { method: 'GET', run: () => game.splash() },
  '/api/progress': { method: 'POST', run: (b) => game.saveProgress(b) },
  '/api/daily/start': { method: 'POST', run: (b) => game.dailyStart(b) },
  '/api/daily/next': { method: 'POST', run: (b) => game.dailyNext(b) },
  '/api/daily/answer': { method: 'POST', run: (b) => game.dailyAnswer(b) },
  '/api/leaderboard': { method: 'GET', run: (_b, url) => game.leaderboard(url.searchParams.get('board')) },
  '/api/blitz': { method: 'POST', run: (b) => game.blitz(b) },

  '/internal/menu/new-post': { method: 'POST', run: () => admin.menuNewPost() },
  '/internal/menu/results': { method: 'POST', run: () => admin.menuResults() },
  '/internal/menu/delete-data': { method: 'POST', run: () => admin.menuDeleteData() },
  '/internal/form/results': { method: 'POST', run: () => admin.formResults() },
  '/internal/form/delete-data': { method: 'POST', run: (b) => admin.formDeleteData(b) },
  '/internal/cron/daily-post': { method: 'POST', run: () => admin.cronDailyPost() },
  '/internal/cron/month-close': { method: 'POST', run: () => admin.cronMonthClose() },
  '/internal/on/app/install': { method: 'POST', run: () => admin.onInstall() },
}

export async function onReq(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://webview.local')
    const route = routes[url.pathname]
    if (!route || route.method !== req.method) return writeJson(rsp, 404, { error: 'not found', status: 404 })
    const body = req.method === 'POST' ? await readJson(req) : undefined
    writeJson(rsp, 200, (await route.run(body, url)) ?? {})
  } catch (err) {
    if (err instanceof game.HttpError) return writeJson(rsp, err.status, { error: err.message, status: err.status })
    console.error(`server error; ${err instanceof Error ? err.stack : err}`)
    writeJson(rsp, 500, { error: 'server error', status: 500 })
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  req.on('data', (chunk) => chunks.push(chunk))
  await once(req, 'end')
  const text = `${Buffer.concat(chunks)}`
  if (!text) return {}
  try { return JSON.parse(text) } catch { throw new game.HttpError(400, 'bad json') }
}

function writeJson(rsp: ServerResponse, status: number, json: unknown): void {
  const body = JSON.stringify(json)
  rsp.writeHead(status, { 'Content-Length': Buffer.byteLength(body), 'Content-Type': 'application/json' })
  rsp.end(body)
}
