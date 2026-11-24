// When an ad may show. Pure, so the rules are tested on their own.
//
// The game asks at one moment only: when the player leaves a finished round
// (see leaveFinished in ../index.html). An ad is due when
//   - the player has finished at least FIRST_AFTER rounds ever (a new player
//     gets to know the game first),
//   - EVERY rounds have finished since the last ad, and
//   - at least MIN_GAP_MS have passed since the last ad (also across restarts).
// AdMob's own frequency cap, set on the ad unit, is a second limit on top.

export const PACING = {
  firstAfter: 3,          // the first ad comes after the third round ever
  every: 2,               // then at most every second round
  minGapMs: 150_000,      // and never within two and a half minutes of the last
}

const KEY = 'brainblast.ads'

/**
 * storage: { get(key) -> string|null, set(key, value) }; now: () -> ms.
 * Returns { finished(kind) -> boolean (is an ad due now?), shown(), state() }.
 */
export function createPacer(storage, now, rules = PACING) {
  let s = { rounds: 0, sinceAd: 0, lastAdAt: 0, ads: 0 }
  try {
    const raw = storage.get(KEY)
    if (raw) {
      const v = JSON.parse(raw)
      s = { rounds: Number(v.rounds) || 0, sinceAd: Number(v.sinceAd) || 0, lastAdAt: Number(v.lastAdAt) || 0, ads: Number(v.ads) || 0 }
    }
  } catch { /* a bad save starts fresh */ }

  const save = () => { try { storage.set(KEY, JSON.stringify(s)) } catch { /* storage full or blocked */ } }

  return {
    /** A round just finished and the player is moving on. True when an ad should show now. */
    finished() {
      s.rounds++
      s.sinceAd++
      save()
      if (s.rounds < rules.firstAfter) return false
      if (s.ads && s.sinceAd < rules.every) return false
      // A clock set backwards (lastAdAt in the future) must not block ads forever.
      const gap = now() - s.lastAdAt
      if (s.ads && gap >= 0 && gap < rules.minGapMs) return false
      return true
    },
    /** The ad was shown: the count and the clock start again. */
    shown() {
      s.sinceAd = 0
      s.ads++
      s.lastAdAt = now()
      save()
    },
    state: () => ({ ...s }),
  }
}
