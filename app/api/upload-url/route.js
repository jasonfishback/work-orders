// POST /api/upload-url  (header x-checkin-user)  body {unit, name, contentType}
// PIN-gated proxy to kpi's checkin-upload-url: returns a one-shot signed URL the
// phone PUTs the video/photo to directly (bypasses the 4.5MB API body limit).

import { kpiUrl, techOk } from '../../../lib/kpi'

export const dynamic = 'force-dynamic'

export async function POST(req) {
  if (!techOk(req)) return Response.json({ error: 'not on the list' }, { status: 401 })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const target = kpiUrl('/api/admin/checkin-upload-url')
  const secret = process.env.KPI_SYNC_SECRET
  if (!target || !secret) return Response.json({ error: 'kpi sync not configured' }, { status: 500 })
  try {
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wo-secret': secret },
      body: JSON.stringify({ unit: body.unit, name: body.name, contentType: body.contentType }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return Response.json({ error: j.error || 'kpi error' }, { status: 502 })
    return Response.json(j)
  } catch (e) {
    return Response.json({ error: 'kpi unreachable' }, { status: 502 })
  }
}
