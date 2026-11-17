// POST /api/wo-upload-url   body {unit, name, contentType}
// Work-order photos: returns a one-shot signed URL the phone PUTs the photo to
// directly (kpi storage), so photos never ride in the submit body and there is
// no photo-count limit from the 4.5MB API body cap. Images only. Like the
// work-order form itself this is not behind the check-in login.

import { kpiUrl } from '../../../lib/kpi'

export const dynamic = 'force-dynamic'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(req) {
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const contentType = String(body.contentType || '').toLowerCase().split(';')[0].trim()
  if (!IMAGE_TYPES.includes(contentType)) return Response.json({ error: 'photos only' }, { status: 400 })
  const target = kpiUrl('/api/admin/checkin-upload-url')
  const secret = process.env.KPI_SYNC_SECRET
  if (!target || !secret) return Response.json({ error: 'kpi sync not configured' }, { status: 500 })
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wo-secret': secret },
      body: JSON.stringify({ unit: 'wo-' + String(body.unit || 'unknown'), name: body.name, contentType }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return Response.json({ error: j.error || 'kpi error' }, { status: 502 })
    return Response.json(j)
  } catch (e) {
    return Response.json({ error: 'kpi unreachable' }, { status: 502 })
  }
}
