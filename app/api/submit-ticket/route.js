import { Resend } from 'resend'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { kpiUrl } from '../../../lib/kpi'

const resend = new Resend(process.env.RESEND_API_KEY)

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ---------------------------------------------------------------------------
// Helpers. The rule for this route: a work order that reaches us gets emailed.
// Photos, the PDF and the kpi sync each degrade on their own (and say so in
// the email) instead of failing the whole submission.
// ---------------------------------------------------------------------------
const PHOTO_PATH_OK = /^checkins\/uploads\/[A-Za-z0-9_./-]+$/
const PDF_PHOTO_BUDGET = 18 * 1024 * 1024 // photo bytes embedded in the PDF (email cap is 40MB)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const errMsg = (e) => (e && e.message ? e.message : String(e))

async function fetchT(url, opts, ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' }) }
  finally { clearTimeout(t) }
}

function kpiPost(path, payload, ms) {
  const url = kpiUrl(path)
  const secret = process.env.KPI_SYNC_SECRET
  if (!url || !secret) return Promise.reject(new Error('KPI_SYNC_URL / KPI_SYNC_SECRET not set'))
  return fetchT(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wo-secret': secret },
    body: JSON.stringify(payload),
  }, ms)
}

async function mapLimit(list, limit, fn) {
  let next = 0
  async function worker() { while (next < list.length) { const i = next++; await fn(list[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
}

function escHtml(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Turns whatever the form sent into [{name, storage_path|null, bytes|null}].
// New form: photos are already in kpi storage -> {storage_path, name}; we pull
// the bytes back for the PDF. Old/cached form or a failed phone upload:
// inline {dataUrl, name}; we use the bytes and also push the photo into kpi
// storage so it still lands on the equipment profile. Never throws.
async function resolvePhotos(rawPhotos, unitNumber) {
  const list = (Array.isArray(rawPhotos) ? rawPhotos : []).filter(Boolean).slice(0, 200).map((ph) => {
    const out = { name: String(ph.name || 'photo').slice(0, 120), storage_path: null, bytes: null }
    if (typeof ph.storage_path === 'string' && PHOTO_PATH_OK.test(ph.storage_path) && !ph.storage_path.includes('..')) {
      out.storage_path = ph.storage_path
    } else if (typeof ph.dataUrl === 'string' && ph.dataUrl.startsWith('data:image/')) {
      try { out.bytes = Buffer.from(ph.dataUrl.split(',')[1] || '', 'base64'); out.inline = true } catch (_) {}
    }
    return out
  }).filter((ph) => ph.storage_path || (ph.bytes && ph.bytes.length))

  // Stored photos -> bytes
  const stored = list.filter((ph) => ph.storage_path)
  if (stored.length) {
    let urls = {}
    for (let attempt = 0; attempt < 2 && !Object.keys(urls).length; attempt++) {
      try {
        const r = await kpiPost('/api/admin/wo-intake/files', { action: 'photo-urls', paths: stored.map((ph) => ph.storage_path) }, 15000)
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.urls) urls = j.urls
        else console.error('photo-urls: kpi returned', r.status, j && j.error)
      } catch (e) { console.error('photo-urls failed:', errMsg(e)) }
    }
    await mapLimit(stored, 6, async (ph) => {
      const u = urls[ph.storage_path]
      if (!u) return
      for (let attempt = 0; attempt < 2 && !ph.bytes; attempt++) {
        try {
          const r = await fetchT(u, {}, 20000)
          if (r.ok) ph.bytes = Buffer.from(await r.arrayBuffer())
        } catch (e) { console.error('photo download failed:', ph.storage_path, errMsg(e)) }
      }
    })
  }

  // Inline photos -> kpi storage (best effort)
  await mapLimit(list.filter((ph) => ph.inline), 4, async (ph) => {
    try {
      const isPng = ph.bytes[0] === 0x89 && ph.bytes[1] === 0x50
      const contentType = isPng ? 'image/png' : 'image/jpeg'
      const r = await kpiPost('/api/admin/checkin-upload-url', { unit: 'wo-' + String(unitNumber || 'unknown'), name: ph.name, contentType }, 10000)
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.signedUrl) return
      const put = await fetchT(j.signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: ph.bytes }, 30000)
      if (put.ok) ph.storage_path = j.path
    } catch (e) { console.error('inline photo store failed:', errMsg(e)) }
  })

  return list
}

const TO = ['jfishback@simonexpress.com', 'csimon@simonexpress.com', 'tsimon@simonexpress.com']
// Link-X is being cancelled — no longer BCC work orders to them.
const BCC = []

const CC_MAP = {
  jaden:  ['jsimon@simonexpress.com'],
  jordan: ['jordan@simonexpress.com'],
  split:  ['jsimon@simonexpress.com', 'jordan@simonexpress.com'],
  luis:   ['ghovanhypartida73@gmail.com', 'jsimon@simonexpress.com'],
  rusty:  ['rfullmer@simonexpress.com'],
  other:  [],
}

const BLACK  = rgb(0,    0,    0)
const DGRAY  = rgb(0.2,  0.2,  0.2)
const MGRAY  = rgb(0.45, 0.45, 0.45)
const LGRAY  = rgb(0.92, 0.92, 0.92)
const BORDER = rgb(0.75, 0.75, 0.75)
const WHITE  = rgb(1,    1,    1)
const RED    = rgb(0.8,  0,    0)
const NAVY   = rgb(0.1,  0.1,  0.18)

function drawRect(page, x, y, w, h, fill, strokeColor, strokeWidth) {
  if (fill)        page.drawRectangle({ x, y, width: w, height: h, color: fill })
  if (strokeColor) page.drawRectangle({ x, y, width: w, height: h, borderColor: strokeColor, borderWidth: strokeWidth || 0.75, color: undefined })
}
function drawLine(page, x1, y1, x2, y2, color, thickness) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: thickness || 0.5, color: color || BORDER })
}
// The PDF's built-in Helvetica can only draw WinAnsi characters. Anything
// else (a line break, a tab, an emoji) makes pdf-lib throw, which used to
// fail the whole submission with "Internal server error" whenever someone
// pressed Enter in the notes box. Keep line breaks (wrapText turns them into
// new lines) and swap anything undrawable for a safe stand-in.
const WINANSI_EXTRA = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178'
function pdfSafe(str) {
  let out = ''
  for (const ch of String(str == null ? '' : str).replace(/\r\n?/g, '\n')) {
    const c = ch.codePointAt(0)
    if (ch === '\n') out += '\n'
    else if (ch === '\t') out += ' '
    else if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || WINANSI_EXTRA.includes(ch)) out += ch
    else if (c < 0x20 || c === 0x7F || c === 0x200B || c === 0x200D || (c >= 0xFE00 && c <= 0xFE0F)) continue // invisible
    else out += '?'
  }
  return out
}
function text(page, str, x, y, size, font, color) {
  if (!str) return
  const s = pdfSafe(str).replace(/\n/g, ' ')
  if (!s) return
  page.drawText(s, { x, y, size: size || 10, font, color: color || BLACK })
}
// Wraps to maxW. Line breaks in the input start a new line, and a single
// "word" wider than the line (a long part number, no spaces) is split.
function wrapText(str, font, size, maxW) {
  const lines = []
  for (const para of pdfSafe(str).split('\n')) {
    let line = ''
    for (let w of para.split(' ')) {
      while (font.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
        let n = w.length - 1
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--
        if (line) { lines.push(line); line = '' }
        lines.push(w.slice(0, n))
        w = w.slice(n)
      }
      const test = line ? line + ' ' + w : w
      if (font.widthOfTextAtSize(test, size) > maxW) {
        if (line) lines.push(line)
        line = w
      } else line = test
    }
    if (line) lines.push(line)
  }
  return lines
}

// Format date from YYYY-MM-DD to MM-DD-YYYY
function fmtDate(d) {
  if (!d) return d
  const parts = d.split('-')
  if (parts.length === 3 && parts[0].length === 4) return parts[1] + '-' + parts[2] + '-' + parts[0]
  return d
}

async function buildInvoicePdf(data, invoiceNum) {
  const { personKey, personName, unitNumber, lineItems, rateType, flatAmount, hourlyRate, totalAmount, photos, parts } = data
  const dateCompleted = fmtDate(data.dateCompleted)

  const pdfDoc  = await PDFDocument.create()
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const W = 612, H = 792, ML = 48, MR = 48, MT = 48
  const CW = W - ML - MR

  let pg = pdfDoc.addPage([W, H])
  const contentPages = [pg]
  let y = H - MT
  // Long work orders flow onto extra pages instead of running off the bottom.
  const BOTTOM = 60
  function need(h) {
    if (y - h < BOTTOM) {
      pg = pdfDoc.addPage([W, H])
      contentPages.push(pg)
      y = H - MT
    }
  }

  // Title
  text(pg, 'WORK ORDER INVOICE', ML, y, 22, bold, NAVY)
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const invLabel = 'Invoice #: ' + invoiceNum
  text(pg, invLabel, W - MR - bold.widthOfTextAtSize(invLabel, 10), y, 10, bold, MGRAY)
  y -= 16
  const dateLabel = 'Date: ' + dateStr
  text(pg, dateLabel, W - MR - regular.widthOfTextAtSize(dateLabel, 9), y, 9, regular, MGRAY)
  y -= 8
  drawLine(pg, ML, y, W - MR, y, RED, 2)
  y -= 20

  // PAY TO / INVOICE TO boxes
  const boxH = 100, boxW = (CW - 16) / 2
  drawRect(pg, ML, y - boxH, boxW, boxH, LGRAY, BORDER, 0.75)
  text(pg, 'PAY TO:', ML + 10, y - 14, 8, bold, MGRAY)
  text(pg, personName, ML + 10, y - 30, 12, bold, NAVY)
  if (rateType === 'hourly' && hourlyRate) text(pg, 'Rate: $' + parseFloat(hourlyRate).toFixed(2) + '/hr', ML + 10, y - 48, 9, regular, DGRAY)
  if (rateType === 'flat') text(pg, 'Flat Rate', ML + 10, y - 48, 9, regular, DGRAY)

  const rx = ML + boxW + 16
  drawRect(pg, rx, y - boxH, boxW, boxH, WHITE, BORDER, 0.75)
  text(pg, 'INVOICE TO:', rx + 10, y - 14, 8, bold, MGRAY)
  text(pg, 'Simon Express', rx + 10, y - 30, 12, bold, NAVY)
  text(pg, 'PO Box 1582', rx + 10, y - 46, 9, regular, DGRAY)
  text(pg, 'Riverton, UT 84065', rx + 10, y - 59, 9, regular, DGRAY)
  text(pg, 'Phone: 801-260-7010', rx + 10, y - 72, 9, regular, DGRAY)
  y -= boxH + 20

  // Job details strip
  drawRect(pg, ML, y - 26, CW, 26, NAVY, undefined)
  text(pg, 'Unit: ' + unitNumber, ML + 10, y - 17, 9, bold, WHITE)
  text(pg, 'Date Completed: ' + dateCompleted, ML + 130, y - 17, 9, bold, WHITE)
  if (personKey === 'split') {
    const spLabel = 'SPLIT PAY INVOICE'
    text(pg, spLabel, W - MR - bold.widthOfTextAtSize(spLabel, 8) - 10, y - 17, 8, bold, RED)
  }
  y -= 26

  // Line items table header
  const COL_DESC = ML, COL_HRS = W - MR - 180, COL_RATE = W - MR - 100, COL_AMT = W - MR - 10, RROW = 22
  drawRect(pg, ML, y - RROW, CW, RROW, LGRAY, BORDER, 0.5)
  text(pg, 'DESCRIPTION', COL_DESC + 8, y - 15, 8, bold, MGRAY)
  text(pg, 'HRS',         COL_HRS,      y - 15, 8, bold, MGRAY)
  text(pg, 'RATE',        COL_RATE,     y - 15, 8, bold, MGRAY)
  const amtW = bold.widthOfTextAtSize('AMOUNT', 8)
  text(pg, 'AMOUNT', COL_AMT - amtW, y - 15, 8, bold, MGRAY)
  y -= RROW

  // Line item rows
  let grandTotal = 0
  const items = lineItems || []
  const hourlyRateVal = parseFloat(hourlyRate) || 0

  items.forEach(function(item, idx) {
    const hrs        = parseFloat(item.hours) || 0
    const itemRate   = parseFloat(item.rate) || 0
    // Flat rate per line item always trumps hourly rate
    const useFlatRate = itemRate > 0
    let lineAmt = 0
    if (useFlatRate) {
      lineAmt = itemRate
    } else if (rateType === 'hourly' && hrs > 0 && hourlyRateVal > 0) {
      lineAmt = hrs * hourlyRateVal
    }
    grandTotal += lineAmt

    const rowBg = idx % 2 === 0 ? WHITE : rgb(0.97, 0.97, 0.97)
    // Row grows to fit the whole description (it used to be cut off at 2 lines).
    const descLines = wrapText(item.description || '', regular, 9, COL_HRS - COL_DESC - 16).slice(0, 55)
    const rowH = Math.max(24, descLines.length * 11 + 13)
    need(rowH)
    drawRect(pg, ML, y - rowH, CW, rowH, rowBg, BORDER, 0.5)
    descLines.forEach(function(l, li) {
      text(pg, l, COL_DESC + 8, y - 10 - li * 11, 9, regular, BLACK)
    })

    // HRS col: always show if entered; grey if using flat rate
    text(pg, hrs > 0 ? hrs.toFixed(2) : '-', COL_HRS, y - 10, 9, regular, useFlatRate ? MGRAY : BLACK)
    // RATE col: show hourly rate if using hourly, dash if flat
    if (!useFlatRate && rateType === 'hourly' && hourlyRateVal > 0) {
      text(pg, '$' + hourlyRateVal.toFixed(2), COL_RATE, y - 10, 9, regular, BLACK)
    } else {
      text(pg, '-', COL_RATE, y - 10, 9, regular, MGRAY)
    }
    // AMOUNT col
    const amtStr = lineAmt > 0 ? '$' + lineAmt.toFixed(2) : '-'
    const aw = regular.widthOfTextAtSize(amtStr, 9)
    text(pg, amtStr, COL_AMT - aw, y - 10, 9, regular, BLACK)
    y -= rowH
  })

  // Totals
  need(100)
  y -= 10
  drawLine(pg, COL_RATE - 20, y, W - MR, y, BORDER, 0.75)
  y -= 16
  const effectiveTotal = rateType === 'flat' ? parseFloat(flatAmount || totalAmount || grandTotal) : grandTotal
  const totalStr = '$' + effectiveTotal.toFixed(2)
  text(pg, 'TOTAL DUE', W - MR - bold.widthOfTextAtSize('TOTAL DUE', 9), y, 9, bold, MGRAY)
  y -= 26
  const tw = bold.widthOfTextAtSize(totalStr, 22)
  text(pg, totalStr, W - MR - tw, y, 22, bold, RED)
  y -= 40

  // Hourly summary bar
  if (rateType === 'hourly') {
    need(30)
    const totalHrs = items.reduce((s, i) => s + (parseFloat(i.hours) || 0), 0)
    const summaryStr = 'Total Hours: ' + totalHrs.toFixed(2) + '  x  $' + hourlyRateVal.toFixed(2) + '/hr  =  $' + grandTotal.toFixed(2)
    drawRect(pg, ML, y - 22, CW, 22, LGRAY, BORDER, 0.5)
    text(pg, summaryStr, ML + 10, y - 14, 9, regular, DGRAY)
    y -= 22
  }

  // Split pay block
  if (personKey === 'split') {
    const totalDue = effectiveTotal
    const splitAmt = totalDue / 2
    const splitStr = '$' + splitAmt.toFixed(2)
    need(130)
    y -= 10
    drawRect(pg, ML, y - 26, CW, 26, NAVY, undefined)
    text(pg, 'PAYMENT BREAKDOWN  -  50/50 SPLIT', ML + 10, y - 17, 9, bold, WHITE)
    const spW = bold.widthOfTextAtSize('SPLIT PAY INVOICE', 8)
    text(pg, 'SPLIT PAY INVOICE', W - MR - spW - 10, y - 17, 8, bold, RED)
    y -= 26
    const bw = (CW - 10) / 2
    // Jaden box
    drawRect(pg, ML, y - 80, bw, 80, rgb(0.97, 0.97, 1.0), BORDER, 0.75)
    drawRect(pg, ML, y - 22, bw, 22, rgb(0.2, 0.2, 0.35), undefined)
    text(pg, 'PAY TO', ML + 8, y - 14, 7, bold, rgb(0.6, 0.7, 0.9))
    text(pg, 'Jaden Simon', ML + 8, y - 38, 11, bold, NAVY)
    text(pg, '50% of Total Invoice', ML + 8, y - 52, 8, regular, DGRAY)
    const jsw = bold.widthOfTextAtSize(splitStr, 18)
    text(pg, splitStr, ML + bw - jsw - 8, y - 68, 18, bold, RED)
    // Jordan box
    const rx2 = ML + bw + 10
    drawRect(pg, rx2, y - 80, bw, 80, rgb(0.97, 0.97, 1.0), BORDER, 0.75)
    drawRect(pg, rx2, y - 22, bw, 22, rgb(0.2, 0.2, 0.35), undefined)
    text(pg, 'PAY TO', rx2 + 8, y - 14, 7, bold, rgb(0.6, 0.7, 0.9))
    text(pg, 'Jordan Simon', rx2 + 8, y - 38, 11, bold, NAVY)
    text(pg, '50% of Total Invoice', rx2 + 8, y - 52, 8, regular, DGRAY)
    const jrw = bold.widthOfTextAtSize(splitStr, 18)
    text(pg, splitStr, rx2 + bw - jrw - 8, y - 68, 18, bold, RED)
    y -= 90
  }

  // Parts / Materials (company-paid) — separate from the labor payout above.
  const partsArr = Array.isArray(parts) ? parts.filter(function (p) { return (p.description || '').trim() || parseFloat(p.cost) > 0 }) : []
  if (partsArr.length > 0) {
    const partsSum = partsArr.reduce(function (s, p) { return s + (parseFloat(p.cost) || 0) }, 0)
    const PC_VEND = ML + CW * 0.5
    need(80)
    y -= 16
    drawRect(pg, ML, y - 22, CW, 22, NAVY, undefined)
    text(pg, 'PARTS / MATERIALS  (COMPANY-PAID)', ML + 10, y - 15, 9, bold, WHITE)
    const phLbl = 'NOT INCLUDED IN PAYOUT'
    text(pg, phLbl, W - MR - bold.widthOfTextAtSize(phLbl, 7) - 10, y - 15, 7, bold, rgb(0.7, 0.8, 0.95))
    y -= 22
    drawRect(pg, ML, y - 18, CW, 18, LGRAY, BORDER, 0.5)
    text(pg, 'PART', ML + 8, y - 12, 7.5, bold, MGRAY)
    text(pg, 'VENDOR', PC_VEND, y - 12, 7.5, bold, MGRAY)
    text(pg, 'COST', COL_AMT - bold.widthOfTextAtSize('COST', 7.5), y - 12, 7.5, bold, MGRAY)
    y -= 18
    partsArr.forEach(function (p, idx) {
      need(16)
      const c = parseFloat(p.cost) || 0
      const cStr = '$' + c.toFixed(2)
      if (idx % 2 === 1) drawRect(pg, ML, y - 16, CW, 16, rgb(0.97, 0.97, 0.97), undefined)
      text(pg, String(p.description || '-').slice(0, 46), ML + 8, y - 11, 9, regular, BLACK)
      text(pg, String(p.vendor || '-').slice(0, 26), PC_VEND, y - 11, 9, regular, DGRAY)
      text(pg, cStr, COL_AMT - regular.widthOfTextAtSize(cStr, 9), y - 11, 9, regular, BLACK)
      y -= 16
    })
    need(64)
    drawLine(pg, COL_RATE - 20, y, W - MR, y, BORDER, 0.5)
    y -= 14
    const psStr = '$' + partsSum.toFixed(2)
    text(pg, 'PARTS SUBTOTAL', COL_RATE - 20, y, 8, bold, MGRAY)
    text(pg, psStr, W - MR - regular.widthOfTextAtSize(psStr, 9), y, 9, bold, DGRAY)
    y -= 20
    const jobLabor = parseFloat(totalAmount || 0)
    const jobTotal = jobLabor + partsSum
    drawRect(pg, ML, y - 22, CW, 22, rgb(0.93, 0.95, 0.98), BORDER, 0.5)
    const jtStr = 'Labor $' + jobLabor.toFixed(2) + '   +   Parts $' + partsSum.toFixed(2) + '   =   Total Job Cost $' + jobTotal.toFixed(2)
    text(pg, jtStr, ML + 10, y - 15, 9, bold, NAVY)
    y -= 22
  }

  // Notes
  if (data.notes && data.notes.trim()) {
    const noteLines = wrapText(data.notes.trim(), regular, 9.5, CW - 20)
    need(14 + 18 + 36)
    y -= 14
    drawRect(pg, ML, y - 18, CW, 18, NAVY, undefined)
    text(pg, 'NOTES', ML + 10, y - 12, 8, bold, WHITE)
    y -= 18
    // Drawn a line at a time so long notes continue onto the next page.
    drawRect(pg, ML, y - 6, CW, 6, LGRAY, undefined)
    y -= 6
    noteLines.forEach(function(l) {
      need(14)
      drawRect(pg, ML, y - 14, CW, 14, LGRAY, undefined)
      text(pg, l, ML + 10, y - 10, 9.5, regular, DGRAY)
      y -= 14
    })
    drawRect(pg, ML, y - 6, CW, 6, LGRAY, undefined)
    y -= 6
  }

  // Photo note
  if (photos && photos.length > 0) {
    need(20)
    y -= 14
    text(pg, photos.length + ' photo' + (photos.length > 1 ? 's' : '') + ' attached - see following page' + (photos.length > 1 ? 's' : ''), ML, y, 8, oblique, MGRAY)
  }

  // Footer on every content page
  const photoCount = photos ? photos.length : 0
  const totalPages = contentPages.length + photoCount
  contentPages.forEach(function (cp, ci) {
    drawLine(cp, ML, 44, W - MR, 44, BORDER, 0.5)
    text(cp, 'Simon Express Work Order  |  ' + invoiceNum, ML, 30, 7.5, regular, MGRAY)
    text(cp, 'Page ' + (ci + 1) + ' of ' + totalPages, W - MR - 60, 30, 7.5, regular, MGRAY)
  })

  // Photo pages
  if (photos && photos.length > 0) {
    for (let pi = 0; pi < photos.length; pi++) {
      const photo = photos[pi]
      const pp = pdfDoc.addPage([W, H])
      drawRect(pp, 0, H - 44, W, 44, NAVY, undefined)
      text(pp, 'WORK ORDER INVOICE - PHOTO DOCUMENTATION', ML, H - 26, 10, bold, WHITE)
      text(pp, invoiceNum + '  |  Unit: ' + unitNumber + '  |  ' + personName, ML, H - 38, 7.5, regular, rgb(0.6, 0.7, 0.8))
      text(pp, 'Photo ' + (pi + 1) + ' of ' + photos.length + ': ' + (photo.name || ''), ML, H - 58, 8, bold, NAVY)
      drawLine(pp, ML, H - 64, W - MR, H - 64, BORDER, 0.5)
      try {
        const bytes  = photo.bytes
        if (!bytes || !bytes.length) throw new Error('no image data')
        const isPng  = bytes[0] === 0x89 && bytes[1] === 0x50
        const img    = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
        const availW = W - ML - MR, availH = H - 110
        const scale  = Math.min(availW / img.width, availH / img.height, 1)
        pp.drawImage(img, { x: ML + (availW - img.width * scale) / 2, y: H - 72 - img.height * scale, width: img.width * scale, height: img.height * scale })
      } catch (_) {
        text(pp, '(Image could not be rendered)', ML, H - 200, 10, regular, MGRAY)
      }
      drawLine(pp, ML, 44, W - MR, 44, BORDER, 0.5)
      text(pp, 'Simon Express Work Order  |  ' + invoiceNum, ML, 30, 7.5, regular, MGRAY)
      text(pp, 'Page ' + (contentPages.length + pi + 1) + ' of ' + totalPages, W - MR - 60, 30, 7.5, regular, MGRAY)
    }
  }

  return Buffer.from(await pdfDoc.save())
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { personKey, personName, otherEmail, unitNumber, lineItems, notes, rateType, flatAmount, hourlyRate } = body
    const warnings = [] // shown in the email when something had to degrade

    // Photos: get bytes for the PDF, storage paths for kpi.
    const allPhotos = await resolvePhotos(body.photos, unitNumber)
    const droppedOnPhone = parseInt(body.photosDropped, 10) || 0
    if (droppedOnPhone > 0) warnings.push(droppedOnPhone + ' photo' + (droppedOnPhone > 1 ? 's' : '') + ' could not be uploaded from the phone and ' + (droppedOnPhone > 1 ? 'are' : 'is') + ' missing from this work order.')
    // Keep the PDF at an emailable size: photos past the budget stay in kpi only.
    const photos = []
    let photoBytes = 0, notInPdf = 0
    for (const ph of allPhotos) {
      const size = ph.bytes ? ph.bytes.length : 0
      if (photoBytes + size > PDF_PHOTO_BUDGET) { notInPdf++; continue }
      photoBytes += size
      photos.push(ph)
    }
    if (notInPdf > 0) warnings.push(notInPdf + ' photo' + (notInPdf > 1 ? 's were' : ' was') + ' left out of the PDF to keep it small enough to email. All photos are on the unit\'s equipment profile in kpi.')
    const partsList = (Array.isArray(body.parts) ? body.parts : [])
      .filter(p => (p.description || '').trim() || parseFloat(p.cost) > 0)
    const partsTotal = partsList.reduce((s, p) => s + (parseFloat(p.cost) || 0), 0)
    const dateCompleted = fmtDate(body.dateCompleted)

    const ccList = [...(CC_MAP[personKey] || [])]
    if (personKey === 'other' && otherEmail) ccList.push(otherEmail)

    const hourlyRateVal = parseFloat(hourlyRate) || 0
    const totalHrs = (lineItems || []).reduce((s, i) => s + (parseFloat(i.hours) || 0), 0)

    // Effective total: sum per-line-item rates if any, else hourly or flat
    const lineItemRatesSum = (lineItems || []).reduce((s, i) => s + (parseFloat(i.rate) || 0), 0)
    const anyLineItemRates = (lineItems || []).some(i => parseFloat(i.rate) > 0)
    let totalAmount
    if (rateType === 'hourly') {
      totalAmount = (totalHrs * hourlyRateVal).toFixed(2)
    } else if (anyLineItemRates) {
      totalAmount = lineItemRatesSum.toFixed(2)
    } else {
      totalAmount = parseFloat(flatAmount || 0).toFixed(2)
    }
    const effectiveFlatAmount = anyLineItemRates ? lineItemRatesSum.toFixed(2) : (flatAmount || '0')

    // Invoice number. kpi hands these out from a Postgres sequence, so each
    // number is issued exactly once. (The old Edge Config counter was a
    // read-then-write: two work orders 26s apart both got WO-0141 on 11/16/26.)
    // If kpi can't be reached, fall back to a timestamp-based number, which is
    // unique and can't collide with the 4-digit sequence numbers.
    let invoiceNum = ''
    try {
      const numUrl = kpiUrl('/api/admin/wo-intake/next-number')
      const numSecret = process.env.KPI_SYNC_SECRET
      if (!numUrl || !numSecret) throw new Error('KPI_SYNC_URL / KPI_SYNC_SECRET not set')
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const numRes = await fetch(numUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wo-secret': numSecret },
        body: '{}',
        cache: 'no-store',
        signal: ctrl.signal,
      })
      clearTimeout(t)
      const numJson = numRes.ok ? await numRes.json() : null
      if (!numJson || !/^WO-\d{4,}$/.test(numJson.invoiceNum || '')) {
        throw new Error('next-number returned HTTP ' + numRes.status)
      }
      invoiceNum = numJson.invoiceNum
    } catch (e) {
      console.error('WO number allocation failed, using timestamp fallback:', e && e.message ? e.message : e)
      invoiceNum = 'WO-T' + Date.now().toString(36).toUpperCase()
    }

    // PDF. If it can't be built with photos, build it without; if it can't be
    // built at all, the email still goes out with the details in the body.
    const pdfData = { ...body, dateCompleted, totalAmount, notes, flatAmount: effectiveFlatAmount }
    const pdfName = 'WorkOrder_' + String(unitNumber || '').replace(/[^a-zA-Z0-9]/g, '_') + '_' + dateCompleted + '.pdf'
    let pdfBuffer = null
    let pdfHasPhotos = photos.length > 0
    try {
      pdfBuffer = await buildInvoicePdf({ ...pdfData, photos }, invoiceNum)
    } catch (e) {
      console.error('PDF build failed, retrying without photos:', e)
      pdfHasPhotos = false
      try {
        pdfBuffer = await buildInvoicePdf({ ...pdfData, photos: [] }, invoiceNum)
        if (photos.length) warnings.push('The photos could not be added to the PDF.')
      } catch (e2) {
        console.error('PDF build failed without photos:', e2)
        warnings.push('The PDF could not be generated for this work order. The details are in this email.')
      }
    }

    // Email line item rows
    const itemRows = (lineItems || []).map((item, idx) => {
      const hrs        = parseFloat(item.hours) || 0
      const itemRate   = parseFloat(item.rate) || 0
      const useFlatRate = itemRate > 0
      const amt        = useFlatRate ? itemRate : (hrs * hourlyRateVal)
      return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9f9'}">
        <td style="padding:8px 12px;font-size:13px;color:#999;border-bottom:1px solid #f0f0f0;text-align:center;width:28px;">${idx + 1}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0;">${escHtml(item.description) || '-'}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center;border-bottom:1px solid #f0f0f0;">${hrs > 0 ? hrs.toFixed(2) : '-'}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:right;border-bottom:1px solid #f0f0f0;font-weight:600;">${amt > 0 ? '$' + amt.toFixed(2) : '-'}</td>
      </tr>`
    }).join('')

    // Parts / materials email block (company-paid, separate from labor payout)
    const partsHtml = partsList.length > 0 ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Parts / Materials <span style="color:#bbb;font-weight:600;">(company-paid — not in payout)</span></div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
        <thead><tr style="background:#f0f0f0;">
          <th style="padding:8px 12px;font-size:11px;text-align:left;color:#999;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e0e0e0;">Part</th>
          <th style="padding:8px 12px;font-size:11px;text-align:left;color:#999;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e0e0e0;">Vendor</th>
          <th style="padding:8px 12px;font-size:11px;text-align:right;color:#999;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e0e0e0;">Cost</th>
        </tr></thead>
        <tbody>${partsList.map((p, idx) => `<tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9f9'}">
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0;">${escHtml(p.description) || '-'}</td>
          <td style="padding:8px 12px;font-size:13px;color:#555;border-bottom:1px solid #f0f0f0;">${escHtml(p.vendor) || '-'}</td>
          <td style="padding:8px 12px;font-size:13px;text-align:right;font-weight:600;border-bottom:1px solid #f0f0f0;">$${(parseFloat(p.cost) || 0).toFixed(2)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div style="text-align:right;padding:8px 12px;font-size:13px;color:#444;">
        Parts subtotal: <strong>$${partsTotal.toFixed(2)}</strong> &nbsp;·&nbsp; Total job cost (labor + parts): <strong>$${(parseFloat(totalAmount) + partsTotal).toFixed(2)}</strong>
      </div>
    </div>` : ''

    // Split pay email block
    const splitPayHtml = personKey === 'split' ? `
    <div style="margin:20px 0;border-radius:8px;overflow:hidden;border:1px solid #ddd;">
      <div style="background:#1a1a2e;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Payment Breakdown - 50/50 Split</span>
        <span style="color:#CC0000;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SPLIT PAY INVOICE</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:50%;padding:16px;background:#f5f5ff;border-right:1px solid #ddd;vertical-align:top;">
            <div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Pay To</div>
            <div style="font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:4px;">Jaden Simon</div>
            <div style="font-size:11px;color:#888;margin-bottom:12px;">50% of Total Invoice</div>
            <div style="font-size:26px;font-weight:800;color:#CC0000;">$${(parseFloat(totalAmount)/2).toFixed(2)}</div>
          </td>
          <td style="width:50%;padding:16px;background:#f5f5ff;vertical-align:top;">
            <div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Pay To</div>
            <div style="font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:4px;">Jordan Simon</div>
            <div style="font-size:11px;color:#888;margin-bottom:12px;">50% of Total Invoice</div>
            <div style="font-size:26px;font-weight:800;color:#CC0000;">$${(parseFloat(totalAmount)/2).toFixed(2)}</div>
          </td>
        </tr>
      </table>
    </div>` : ''

    // Outlook calendar links
    var payDate = new Date()
    payDate.setDate(payDate.getDate() + 7)
    var pad = function(n) { return String(n).padStart(2,'0') }
    var evtYear = payDate.getFullYear()
    var evtMonth = pad(payDate.getMonth()+1)
    var evtDay = pad(payDate.getDate())
    var evtDateStr = '' + evtYear + evtMonth + evtDay
    var calSubject = encodeURIComponent('PAY - Work Order ' + invoiceNum + ' - ' + personName)
    var calBody = encodeURIComponent('Pay work order ' + invoiceNum + ' for ' + personName + '. Unit: ' + unitNumber + '. Date completed: ' + dateCompleted + '. Amount: $' + totalAmount)
    var outlookUrl = 'https://outlook.live.com/calendar/0/deeplink/compose?subject=' + calSubject + '&body=' + calBody + '&startdt=' + evtYear + '-' + evtMonth + '-' + evtDay + '&enddt=' + evtYear + '-' + evtMonth + '-' + evtDay + '&allday=true&path=%2Fcalendar%2Faction%2Fcompose&rru=addevent'
    var outlook365Url = 'https://outlook.office.com/calendar/0/deeplink/compose?subject=' + calSubject + '&body=' + calBody + '&startdt=' + evtYear + '-' + evtMonth + '-' + evtDay + '&enddt=' + evtYear + '-' + evtMonth + '-' + evtDay + '&allday=true&path=%2Fcalendar%2Faction%2Fcompose&rru=addevent'
    var icsLines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Simon Express//EN','BEGIN:VEVENT','DTSTART;VALUE=DATE:' + evtDateStr,'DTEND;VALUE=DATE:' + evtDateStr,'SUMMARY:PAY - Work Order ' + invoiceNum + ' - ' + personName,'DESCRIPTION:Amount $' + totalAmount + ' for ' + personName + ' - Unit ' + unitNumber,'END:VEVENT','END:VCALENDAR']
    var icsDataUrl = 'data:text/calendar;charset=utf8,' + encodeURIComponent(icsLines.join('\r\n'))
    var calDownloadName = 'WorkOrder-' + invoiceNum + '.ics'
    var calendarHtml = '<div style="margin:20px 0;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;">'
      + '<div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Add Pay Reminder to Calendar</div>'
      + '<p style="font-size:12px;color:#666;margin:0 0 12px 0;">Add a reminder to pay this work order (7 days from today).</p>'
      + '<table style="border-collapse:collapse;"><tr>'
      + '<td style="padding-right:8px;"><a href="' + outlookUrl + '" style="display:inline-block;background:#0078d4;color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 14px;border-radius:5px;">+ Outlook Web</a></td>'
      + '<td style="padding-right:8px;"><a href="' + outlook365Url + '" style="display:inline-block;background:#0078d4;color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 14px;border-radius:5px;">+ Outlook 365</a></td>'
      + '<td><a href="' + icsDataUrl + '" download="' + calDownloadName + '" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 14px;border-radius:5px;">+ Download .ics</a></td>'
      + '</tr></table></div>'

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:28px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #ddd;">
  <div style="background:#111;"><div style="background:#CC0000;height:4px;"></div>
    <div style="padding:16px 24px;">
      <span style="font-size:18px;font-weight:700;color:#fff;letter-spacing:1px;text-transform:uppercase;">Simon Express</span>
      <span style="display:block;font-size:10px;color:#9aafca;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Work Order Invoice - ${invoiceNum}</span>
    </div>
  </div>
  <div style="padding:24px;"><!--WARNINGS-->
    <table style="width:100%;margin-bottom:20px;border-collapse:collapse;">
      <tr>
        <td style="width:48%;vertical-align:top;background:#f5f5f5;border:1px solid #ddd;border-radius:6px;padding:12px;">
          <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Pay To</div>
          <div style="font-size:15px;font-weight:700;color:#1a1a2e;">${escHtml(personName)}</div>
          <div style="font-size:12px;color:#666;margin-top:4px;">${rateType === 'hourly' ? 'Rate: $' + hourlyRateVal.toFixed(2) + '/hr' : 'Flat Rate'}</div>
        </td>
        <td style="width:4%;"></td>
        <td style="width:48%;vertical-align:top;border:1px solid #ddd;border-radius:6px;padding:12px;">
          <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Invoice To</div>
          <div style="font-size:15px;font-weight:700;color:#1a1a2e;">Simon Express</div>
          <div style="font-size:12px;color:#666;margin-top:2px;">PO Box 1582<br>Riverton, UT 84065<br>801-260-7010</div>
        </td>
      </tr>
    </table>
    <div style="background:#111;color:#fff;border-radius:6px;padding:9px 14px;font-size:12px;margin-bottom:20px;display:flex;gap:24px;">
      <span><strong>Unit:</strong> ${escHtml(unitNumber)}</span>
      <span><strong>Date Completed:</strong> ${dateCompleted}</span>
      <span><strong>Rate Type:</strong> ${rateType === 'hourly' ? 'Hourly' : 'Flat Rate'}</span>
    </div>
    <div style="margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Work Performed</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="padding:8px 12px;font-size:11px;text-align:left;color:#999;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e0e0e0;">#</th>
            <th style="padding:8px 12px;font-size:11px;text-align:left;color:#999;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e0e0e0;">Description</th>
            <th style="padding:8px 12px;font-size:11px;text-align:center;color:#999;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e0e0e0;">Hrs</th>
            <th style="padding:8px 12px;font-size:11px;text-align:right;color:#999;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e0e0e0;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>
    <div style="text-align:right;padding:14px 0;border-top:2px solid #f0f0f0;margin-bottom:${notes && notes.trim() ? '20px' : '0'};">
      <div style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Due</div>
      <div style="font-size:30px;font-weight:700;color:#CC0000;line-height:1;">$${totalAmount}</div>
      ${partsList.length > 0 ? `<div style="font-size:11px;color:#999;margin-top:4px;">labor only · parts billed to company separately</div>` : ''}
    </div>
    ${partsHtml}
    ${splitPayHtml}
    ${calendarHtml}
    ${notes && notes.trim() ? `<div style="margin-bottom:4px;"><div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Notes</div><div style="background:#f8f8f8;border-left:3px solid #ddd;padding:10px 14px;border-radius:0 6px 6px 0;font-size:13px;line-height:1.6;color:#444;white-space:pre-wrap;">${escHtml(notes.trim())}</div></div>` : ''}
    ${allPhotos.length > 0 ? `<p style="font-size:12px;color:#aaa;margin-top:16px;margin-bottom:0;">${allPhotos.length} photo${allPhotos.length > 1 ? 's' : ''} attached - see PDF.</p>` : ''}
  </div>
  <div style="padding:14px 24px;border-top:1px solid #f0f0f0;text-align:center;">
    <p style="font-size:11px;color:#aaa;margin:0;">Simon Express Work Order System - ${invoiceNum}</p>
  </div>
</div></body></html>`

    // Send. Retries, then sheds weight (photos, then the PDF) rather than fail.
    const withWarnings = (list) => list.length
      ? html.replace('<!--WARNINGS-->', `<div style="margin-bottom:16px;background:#fff8e1;border:1px solid #f0d58a;border-radius:6px;padding:10px 14px;font-size:12px;color:#7a5b00;line-height:1.5;">${list.map(escHtml).join('<br>')}</div>`)
      : html
    const sendEmail = (pdfBuf, warnList) => resend.emails.send({
      from: 'Simon Express Work Orders <tickets@simonexpress.com>',
      to: TO,
      cc: ccList.length > 0 ? ccList : undefined,
      subject: 'Work Order - ' + unitNumber + ' - ' + personName + ' - ' + dateCompleted,
      bcc: BCC.length ? BCC : undefined,
      html: withWarnings(warnList),
      attachments: pdfBuf ? [{ filename: pdfName, content: pdfBuf.toString('base64') }] : undefined,
    }).catch((e) => ({ data: null, error: { message: errMsg(e) } }))

    let sent = await sendEmail(pdfBuffer, warnings)
    if (sent.error) {
      console.error('email send failed, retrying:', sent.error.message)
      await sleep(1500)
      sent = await sendEmail(pdfBuffer, warnings)
    }
    if (sent.error && pdfBuffer && pdfHasPhotos) {
      console.error('email send failed again, retrying with a photo-free PDF:', sent.error.message)
      try {
        const lean = await buildInvoicePdf({ ...pdfData, photos: [] }, invoiceNum)
        sent = await sendEmail(lean, [...warnings, 'The photos were left out of the PDF so this email could be delivered. They are on the unit\'s equipment profile in kpi.'])
      } catch (e) { console.error('lean PDF build failed:', e) }
    }
    if (sent.error && pdfBuffer) {
      console.error('email send failed again, retrying without the PDF:', sent.error.message)
      sent = await sendEmail(null, [...warnings, 'The PDF could not be attached to this email. It is stored on the unit\'s equipment profile in kpi.'])
    }
    const { data, error } = sent
    if (error) {
      console.error('email send failed for good:', error.message)
      return Response.json({ error: 'The work order could not be emailed (' + error.message + '). Nothing was lost - please tap Submit again.' }, { status: 502 })
    }

    // Sync the work order into the kpi maintenance system (kpi.simonexpress.com).
    // Best-effort: a failure here must never break the invoice email above.
    // The PDF goes straight into kpi storage (a photo-heavy PDF is too big for
    // an API body); the intake call then only carries data + storage paths.
    try {
      let pdfStoragePath = null
      if (pdfBuffer) {
        for (let attempt = 0; attempt < 2 && !pdfStoragePath; attempt++) {
          try {
            const r = await kpiPost('/api/admin/wo-intake/files', { action: 'pdf-upload', invoiceNum }, 10000)
            const j = await r.json().catch(() => ({}))
            if (!r.ok || !j.signedUrl) throw new Error('pdf-upload returned HTTP ' + r.status)
            const put = await fetchT(j.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdfBuffer }, 45000)
            if (!put.ok) throw new Error('PDF upload returned HTTP ' + put.status)
            pdfStoragePath = j.path
          } catch (e) { console.error('kpi PDF upload failed:', errMsg(e)) }
        }
      }
      // Fallback: a small PDF can still ride in the body the old way.
      const inlinePdf = !pdfStoragePath && pdfBuffer && pdfBuffer.length < 2.5 * 1024 * 1024 ? pdfBuffer.toString('base64') : null
      const payload = {
        invoiceNum,
        unitNumber,
        personKey,
        personName,
        dateCompleted: body.dateCompleted, // raw YYYY-MM-DD
        rateType,
        totalAmount, // labor (tech payout)
        parts: partsList.map(p => ({ description: p.description, vendor: p.vendor, cost: p.cost })),
        lineItems,
        notes,
        photos: allPhotos.filter((ph) => ph.storage_path).map((ph) => ({ storage_path: ph.storage_path, name: ph.name })),
        pdfStoragePath,
        pdfBase64: inlinePdf,
        pdfName,
      }
      let synced = false
      for (let attempt = 0; attempt < 3 && !synced; attempt++) {
        if (attempt) await sleep(1500 * attempt)
        try {
          const r = await kpiPost('/api/admin/wo-intake', payload, 25000)
          if (r.ok) synced = true
          else console.error('kpi sync: HTTP', r.status, (await r.text().catch(() => '')).slice(0, 200))
        } catch (e) { console.error('kpi sync failed:', errMsg(e)) }
      }
      if (!synced) console.error('kpi sync gave up for', invoiceNum)
    } catch (e) {
      console.error('kpi sync error:', errMsg(e))
    }

    return Response.json({ success: true, id: data.id })
  } catch (err) {
    console.error(err)
    return Response.json({ error: 'Something went wrong sending the work order. Nothing was lost - please tap Submit again.' }, { status: 500 })
  }
}
