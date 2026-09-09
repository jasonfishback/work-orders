// Shared helpers for talking to kpi.simonexpress.com and gating the check-in
// pages. KPI_SYNC_URL is the full wo-intake URL (existing env); we derive the
// origin from it so no new env var is needed for the check-in endpoints.

export function kpiUrl(path) {
  const base = process.env.KPI_SYNC_URL
  if (!base) return null
  try { return new URL(base).origin + path } catch { return null }
}

// Who may use the check-in: type your first name. Aliases map to the
// canonical name that gets stamped on the sheet. Nobody else gets in.
export const TECH_ALIASES = {
  jaden: 'Jaden', jordan: 'Jordan', rusty: 'Rusty', jason: 'Jason', tejay: 'TeJay',
  jaxon: 'Jaxon', ethan: 'Ethan', cameron: 'Cameron', cam: 'Cameron', chas: 'Chas', chasade: 'Chas',
}
export function techName(raw) {
  const k = String(raw || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  return TECH_ALIASES[k] || null
}
// Returns the canonical tech name from the x-checkin-user header, or null.
export function techOk(req) {
  return techName(req.headers.get('x-checkin-user'))
}
