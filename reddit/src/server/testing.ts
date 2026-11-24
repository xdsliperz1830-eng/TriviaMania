// Test helpers shared by the server tests and the browser test: an
// in-memory stand-in for the Redis plugin, enough for this app's calls.
// Not part of the app bundle (nothing in index.ts imports it).
import { mock } from 'node:test'
import { redis } from '@devvit/web/server'

export class FakeRedis {
  strings = new Map<string, string>()
  hashes = new Map<string, Map<string, string>>()
  zsets = new Map<string, Map<string, number>>()
  h(k: string) { let m = this.hashes.get(k); if (!m) this.hashes.set(k, (m = new Map())); return m }
  z(k: string) { let m = this.zsets.get(k); if (!m) this.zsets.set(k, (m = new Map())); return m }
  sorted(k: string) { return [...this.z(k).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)) }
  /** Replace the plugin's methods with this store's. */
  install() {
    const r = redis as any
    const self = this
    const impl: Record<string, (...a: any[]) => any> = {
      async get(k: string) { return self.strings.get(k) },
      async set(k: string, v: string, o?: { nx?: boolean }) {
        if (o?.nx && self.strings.has(k)) return null
        self.strings.set(k, v); return 'OK'
      },
      async del(...ks: string[]) { for (const k of ks.flat()) { self.strings.delete(k); self.hashes.delete(k); self.zsets.delete(k) } },
      async expire() {},
      async hSet(k: string, o: Record<string, string>) { for (const [f, v] of Object.entries(o)) self.h(k).set(f, v); return Object.keys(o).length },
      async hGetAll(k: string) { return Object.fromEntries(self.hashes.get(k) ?? []) },
      async hIncrBy(k: string, f: string, n: number) { const v = Number(self.h(k).get(f) ?? 0) + n; self.h(k).set(f, String(v)); return v },
      async hMGet(k: string, fs: string[]) { return fs.map((f) => self.hashes.get(k)?.get(f) ?? null) },
      async hDel(k: string, fs: string[]) { for (const f of fs) self.hashes.get(k)?.delete(f); return fs.length },
      async zAdd(k: string, ...ms: { member: string; score: number }[]) { for (const m of ms) self.z(k).set(m.member, m.score); return ms.length },
      async zScore(k: string, m: string) { return self.zsets.get(k)?.get(m) },
      async zRank(k: string, m: string) { const i = self.sorted(k).findIndex(([x]) => x === m); return i === -1 ? undefined : i },
      async zCard(k: string) { return self.zsets.get(k)?.size ?? 0 },
      async zRem(k: string, ms: string[]) { for (const m of ms) self.zsets.get(k)?.delete(m); return ms.length },
      async zRange(k: string, start: number, stop: number, o?: { reverse?: boolean }) {
        let all = self.sorted(k)
        if (o?.reverse) all = all.reverse()
        return all.slice(start, stop + 1).map(([member, score]) => ({ member, score }))
      },
    }
    for (const [name, fn] of Object.entries(impl)) mock.method(r, name, fn)
  }
}

