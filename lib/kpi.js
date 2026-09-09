// Shared helpers for talking to kpi.simonexpress.com and gating the check-in
// pages. KPI_SYNC_URL is the full wo-intake URL (existing env); we derive the
// origin from it so no new env var is needed for the check-in endpoints.

export function kpiUrl(path) {
  const base = process.env.KPI_SYNC_URL
  if (!base) return null
  try { return new URL(base).origin + path } catch { return null }
}

// Shop PIN — last 4 of the shop phone. Override with CHECKIN_PIN if it changes.
export function pinOk(req) {
  const expected = String(process.env.CHECKIN_PIN || '7010')
  const got = String(req.headers.get('x-checkin-pin') || '')
  return got.length === expected.length && got === expected
}
