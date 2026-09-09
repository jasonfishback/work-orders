// GET /api/unit-history?unit=25  (header x-checkin-user)
// PIN-gated proxy to kpi's secret-authed unit-history endpoint so the shared
// secret never reaches the browser. `?ping=1` just validates the PIN.

import { kpiUrl, techOk } from '../../../lib/kpi'

export const dynamic = 'force-dynamic'

export async function GET(req) {
  if (!techOk(req)) return Response.json({ error: 'not on the list' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  if (searchParams.get('ping')) return Response.json({ ok: true, user: techOk(req) })
  const unit = String(searchParams.get('unit') || '').trim()
  if (!unit) return Response.json({ error: 'unit required' }, { status: 400 })

  const target = kpiUrl('/api/admin/unit-history')
  const secret = process.env.KPI_SYNC_SECRET
  if (!target || !secret) return Response.json({ error: 'kpi sync not configured' }, { status: 500 })

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    const r = await fetch(target + '?unit=' + encodeURIComponent(unit), {
      headers: { 'x-wo-secret': secret }, cache: 'no-store', signal: ctrl.signal,
    })
    clearTimeout(t)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return Response.json({ error: j.error || 'kpi error' }, { status: 502 })
    return Response.json(j)
  } catch (e) {
    return Response.json({ error: 'kpi unreachable' }, { status: 502 })
  }
}
