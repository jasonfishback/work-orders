// POST /api/check-in  (header x-checkin-user)
// Forwards the check-in record to kpi's checkin-intake. Photos and videos
// were already PUT straight into kpi storage by the phone (see /api/upload-url),
// so this body only carries storage paths — never image bytes. No PDF: the
// photos live on the check-in record in kpi and that is the sheet.

import { kpiUrl, techOk } from '../../../lib/kpi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PATH_OK = /^checkins\/uploads\/[A-Za-z0-9_./-]+$/
const cleanVideos = (arr) => Array.isArray(arr)
  ? arr.filter(v => v && typeof v.storage_path === 'string' && PATH_OK.test(v.storage_path)).map(v => ({ storage_path: v.storage_path, name: String(v.name || 'video'), size: Number(v.size) || 0 }))
  : []
// Stored photo refs only. A cached copy of the old form may still send
// inline {dataUrl} photos — pass those through, kpi still accepts them.
const cleanPhotos = (arr) => Array.isArray(arr)
  ? arr.filter(p => p && ((typeof p.storage_path === 'string' && PATH_OK.test(p.storage_path)) || typeof p.dataUrl === 'string')).map(p => {
      const out = p.storage_path ? { storage_path: p.storage_path, name: String(p.name || 'photo') } : { dataUrl: p.dataUrl, name: String(p.name || 'photo') }
      if (p.pos) out.pos = String(p.pos).slice(0, 12)
      return out
    })
  : []

export async function POST(req) {
  const tech = techOk(req)
  if (!tech) return Response.json({ error: 'not on the list' }, { status: 401 })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }

  const unit = String(body.unit || '').trim()
  const checkedInBy = tech // server-resolved from the login name, never trusted from the body
  const checkedInAt = body.checkedInAt && !isNaN(new Date(body.checkedInAt)) ? new Date(body.checkedInAt).toISOString() : new Date().toISOString()
  const items = Array.isArray(body.items) ? body.items.map(i => ({
    category: String(i.category || 'other'), label: String(i.label || '').trim(), notes: String(i.notes || '').trim(),
    redTag: !!i.redTag, driverFault: !!i.driverFault,
    positions: Array.isArray(i.positions) ? i.positions.map(p => String(p).slice(0, 12)).slice(0, 12) : [],
    positionNotes: i.positionNotes && typeof i.positionNotes === 'object' ? Object.fromEntries(Object.entries(i.positionNotes).filter(([k, v]) => String(v || '').trim()).map(([k, v]) => [String(k).slice(0, 12), String(v).trim().slice(0, 500)])) : {},
    videos: cleanVideos(i.videos), photos: cleanPhotos(i.photos),
  })).filter(i => i.label) : []
  const clean = body.clean === true && !items.length
  const notes = String(body.notes || '').trim() || (clean ? 'Clean — no issues' : '')
  const photos = cleanPhotos(body.photos)
  const videos = cleanVideos(body.videos)
  if (!unit || !checkedInBy) return Response.json({ error: 'unit and name required' }, { status: 400 })
  if (!items.length && !notes && !photos.length && !videos.length) return Response.json({ error: 'add at least one item or a note' }, { status: 400 })

  const target = kpiUrl('/api/admin/checkin-intake')
  const secret = process.env.KPI_SYNC_SECRET
  if (!target || !secret) return Response.json({ error: 'kpi sync not configured' }, { status: 500 })

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 45000)
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wo-secret': secret },
      body: JSON.stringify({
        unit, checkedInBy, checkedInAt,
        driverName: body.driverName || null, driverSource: body.driverSource || null, driverCode: body.driverCode || null,
        items, notes, photos, videos, clean,
      }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('check-in: kpi returned', r.status, j && j.error)
      return Response.json({ error: (j && j.error) || `kpi rejected the check-in (HTTP ${r.status})` }, { status: 502 })
    }
    return Response.json({ success: true, id: j.id, red_tags: j.red_tags || 0 })
  } catch (e) {
    console.error('check-in sync failed:', e && e.message ? e.message : e)
    return Response.json({ error: 'Could not reach kpi — try again' }, { status: 502 })
  }
}
