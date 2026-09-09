// POST /api/check-in  (header x-checkin-pin)
// Builds the check-in sheet PDF (pdf-lib, photos embedded) and pushes the
// whole record + PDF to kpi's checkin-intake. No email — kpi is the record.

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { kpiUrl, pinOk } from '../../../lib/kpi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BLACK = rgb(0, 0, 0), DGRAY = rgb(0.2, 0.2, 0.2), MGRAY = rgb(0.45, 0.45, 0.45)
const LGRAY = rgb(0.93, 0.93, 0.93), BORDER = rgb(0.78, 0.78, 0.78), WHITE = rgb(1, 1, 1)
const RED = rgb(0.8, 0, 0), NAVY = rgb(0.1, 0.1, 0.18), PINK = rgb(1, 0.94, 0.94)

function wrap(str, font, size, maxW) {
  const out = []
  for (const para of String(str || '').split(/\r?\n/)) {
    let line = ''
    for (const w of para.split(' ')) {
      const test = line ? line + ' ' + w : w
      if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = w }
      else line = test
    }
    out.push(line)
  }
  return out
}

function mt(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' MT'
}
function fmtDate(d) {
  if (!d) return '—'
  const p = String(d).slice(0, 10).split('-')
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : d
}

async function buildPdf(data) {
  const { unit, checkedInBy, checkedInAt, driverName, unitSummary, items, notes, photos, clean } = data
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const W = 612, H = 792, ML = 48, MR = 48, MB = 48
  const CW = W - ML - MR

  let page = doc.addPage([W, H])
  let y = H - 48
  const text = (s, x, yy, size, font, color) => { if (s) page.drawText(String(s), { x, y: yy, size, font, color: color || BLACK }) }
  const need = (h) => { if (y - h < MB) { page = doc.addPage([W, H]); y = H - 48 } }

  // Title
  text('EQUIPMENT CHECK-IN', ML, y, 22, bold, NAVY)
  const stamp = mt(checkedInAt)
  text(stamp, W - MR - reg.widthOfTextAtSize(stamp, 9), y + 2, 9, reg, MGRAY)
  y -= 10
  page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 2, color: RED })
  y -= 22

  // Unit strip
  page.drawRectangle({ x: ML, y: y - 30, width: CW, height: 30, color: NAVY })
  text('Unit ' + unit, ML + 12, y - 20, 14, bold, WHITE)
  const desc = unitSummary && unitSummary.summary
    ? [unitSummary.summary.year, unitSummary.summary.make, unitSummary.summary.model].filter(Boolean).join(' ') || unitSummary.summary.type || ''
    : ''
  if (desc) text(desc, ML + 12 + bold.widthOfTextAtSize('Unit ' + unit, 14) + 14, y - 20, 10, reg, rgb(0.85, 0.85, 0.9))
  const redCount = items.filter(i => i.redTag).length
  if (redCount) {
    const lbl = `${redCount} RED TAG${redCount > 1 ? 'S' : ''}`
    text(lbl, W - MR - 12 - bold.widthOfTextAtSize(lbl, 10), y - 20, 10, bold, rgb(1, 0.4, 0.4))
  } else if (clean) {
    const lbl = 'CLEAN — NO ISSUES'
    text(lbl, W - MR - 12 - bold.widthOfTextAtSize(lbl, 10), y - 20, 10, bold, rgb(0.4, 0.9, 0.6))
  }
  y -= 44

  // Meta grid
  const insp = unitSummary && unitSummary.inspection
  const rows = [
    ['Checked in by', checkedInBy],
    ['Driver on unit', driverName || 'Unknown'],
    ['Date / time', stamp],
    ['Inspection due', insp ? `${fmtDate(insp.next_due)} (${insp.days_until < 0 ? -insp.days_until + ' days OVERDUE' : insp.days_until + ' days'})` : 'No inspection on file'],
    ['Odometer', unitSummary && unitSummary.odometer != null ? Number(unitSummary.odometer).toLocaleString() + ' mi' : '—'],
  ]
  const colW = CW / 2
  rows.forEach((r, i) => {
    const x = ML + (i % 2) * colW
    if (i % 2 === 0) { need(30); y -= 0 }
    text(r[0].toUpperCase(), x, y, 7, bold, MGRAY)
    text(r[1], x, y - 12, 10, reg, DGRAY)
    if (i % 2 === 1 || i === rows.length - 1) y -= 30
  })
  y -= 6

  // Items
  text('ITEMS', ML, y, 8, bold, MGRAY)
  y -= 6
  page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.5, color: BORDER })
  y -= 14
  if (!items.length) { text(clean ? 'Clean — no issues found on this quick inspection.' : 'No items flagged.', ML, y, 10, reg, clean ? rgb(0.02, 0.37, 0.27) : MGRAY); y -= 18 }

  for (const it of items) {
    const noteLines = wrap(it.notes, reg, 10, CW - 24)
    const photoRows = Math.ceil((it.photos || []).length / 3)
    const blockH = 22 + noteLines.length * 13 + (it.notes ? 6 : 0)
    need(blockH + 8)
    page.drawRectangle({ x: ML, y: y - blockH + 12, width: CW, height: blockH, color: it.redTag ? PINK : LGRAY, borderColor: it.redTag ? RED : BORDER, borderWidth: it.redTag ? 1 : 0.5 })
    text(it.label + ((it.positions || []).length ? '  ·  ' + it.positions.join(', ') : ''), ML + 10, y - 2, 11, bold, it.redTag ? RED : NAVY)
    const flags = [it.driverFault ? 'DRIVER FAULT' : null, it.redTag ? 'RED TAG — FIX BEFORE UNIT GOES OUT' : null].filter(Boolean).join('   ·   ')
    if (flags) text(flags, W - MR - 10 - bold.widthOfTextAtSize(flags, 8), y - 1, 8, bold, RED)
    let yy = y - 18
    for (const ln of noteLines) { if (it.notes) { text(ln, ML + 12, yy, 10, reg, DGRAY); yy -= 13 } }
    y = y - blockH + 12 - 8

    // Photos: 3 per row, 160pt wide boxes
    if (photoRows) {
      const boxW = (CW - 16) / 3, boxH = 120
      let col = 0
      for (const p of it.photos) {
        if (col === 0) { need(boxH + 8); y -= boxH }
        try {
          const b64 = String(p.dataUrl || '').split(',')[1]
          if (b64) {
            const img = await doc.embedJpg(Uint8Array.from(Buffer.from(b64, 'base64'))) // fresh copy: pooled Buffers give pdf-lib a wrong byte offset ("SOI not found")
            const s = Math.min(boxW / img.width, boxH / img.height)
            const w = img.width * s, h = img.height * s
            const x = ML + col * (boxW + 8) + (boxW - w) / 2
            page.drawImage(img, { x, y: y + (boxH - h) / 2, width: w, height: h })
          }
        } catch (e) { console.error('check-in pdf: item photo skipped:', e && e.message ? e.message : e) }
        col = (col + 1) % 3
        if (col === 0) y -= 8
      }
      if (col !== 0) y -= 8
    }
    y -= 6
  }

  // General notes + photos
  if (notes && notes.trim()) {
    const lines = wrap(notes, reg, 10, CW - 20)
    need(24 + lines.length * 13)
    text('NOTES', ML, y, 8, bold, MGRAY); y -= 14
    for (const ln of lines) { need(13); text(ln, ML + 10, y, 10, reg, DGRAY); y -= 13 }
    y -= 6
  }
  if (photos && photos.length) {
    need(24)
    text('PHOTOS', ML, y, 8, bold, MGRAY); y -= 8
    const boxW = (CW - 16) / 3, boxH = 120
    let col = 0
    for (const p of photos) {
      if (col === 0) { need(boxH + 8); y -= boxH }
      try {
        const b64 = String(p.dataUrl || '').split(',')[1]
        if (b64) {
          const img = await doc.embedJpg(Uint8Array.from(Buffer.from(b64, 'base64'))) // fresh copy: pooled Buffers give pdf-lib a wrong byte offset ("SOI not found")
          const s = Math.min(boxW / img.width, boxH / img.height)
          const w = img.width * s, h = img.height * s
          page.drawImage(img, { x: ML + col * (boxW + 8) + (boxW - w) / 2, y: y + (boxH - h) / 2, width: w, height: h })
        }
      } catch (e) { console.error('check-in pdf: photo skipped:', e && e.message ? e.message : e) }
      col = (col + 1) % 3
      if (col === 0) y -= 8
    }
  }

  // Footer on every page
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    const f = `Simon Express · Equipment Check-In · Unit ${unit} · ${stamp} · ${checkedInBy}  —  page ${i + 1} of ${pages.length}`
    pg.drawText(f, { x: ML, y: 28, size: 7, font: reg, color: MGRAY })
  })

  return Buffer.from(await doc.save()).toString('base64')
}

export async function POST(req) {
  if (!pinOk(req)) return Response.json({ error: 'bad pin' }, { status: 401 })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }

  const unit = String(body.unit || '').trim()
  const checkedInBy = String(body.checkedInBy || '').trim()
  const checkedInAt = body.checkedInAt && !isNaN(new Date(body.checkedInAt)) ? new Date(body.checkedInAt).toISOString() : new Date().toISOString()
  const items = Array.isArray(body.items) ? body.items.map(i => ({
    category: String(i.category || 'other'), label: String(i.label || '').trim(), notes: String(i.notes || '').trim(),
    redTag: !!i.redTag, driverFault: !!i.driverFault, positions: Array.isArray(i.positions) ? i.positions.map(p => String(p).slice(0, 12)).slice(0, 12) : [], photos: Array.isArray(i.photos) ? i.photos.filter(p => p && p.dataUrl) : [],
  })).filter(i => i.label) : []
  const clean = body.clean === true && !items.length
  const notes = String(body.notes || '').trim() || (clean ? 'Clean — no issues' : '')
  const photos = Array.isArray(body.photos) ? body.photos.filter(p => p && p.dataUrl) : []
  if (!unit || !checkedInBy) return Response.json({ error: 'unit and name required' }, { status: 400 })
  if (!items.length && !notes) return Response.json({ error: 'add at least one item or a note' }, { status: 400 })

  const target = kpiUrl('/api/admin/checkin-intake')
  const secret = process.env.KPI_SYNC_SECRET
  if (!target || !secret) return Response.json({ error: 'kpi sync not configured' }, { status: 500 })

  const data = { unit, checkedInBy, checkedInAt, driverName: body.driverName || null, unitSummary: body.unitSummary || null, items, notes, photos, clean }
  let pdfBase64 = null
  try { pdfBase64 = await buildPdf(data) } catch (e) { console.error('check-in pdf failed:', e && e.message ? e.message : e) }
  const pdfName = `CheckIn_${unit}_${checkedInAt.slice(0, 10)}.pdf`

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 45000)
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wo-secret': secret },
      body: JSON.stringify({
        unit, checkedInBy, checkedInAt,
        driverName: body.driverName || null, driverSource: body.driverSource || null, driverCode: body.driverCode || null,
        items, notes, photos, pdfBase64, pdfName, clean,
      }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return Response.json({ error: j.error || 'kpi rejected the check-in' }, { status: 502 })
    return Response.json({ success: true, id: j.id, red_tags: j.red_tags || 0, pdf: !!j.pdf })
  } catch (e) {
    console.error('check-in sync failed:', e && e.message ? e.message : e)
    return Response.json({ error: 'Could not reach kpi — try again' }, { status: 502 })
  }
}
