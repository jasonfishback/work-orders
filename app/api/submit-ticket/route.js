import { Resend } from 'resend'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const resend = new Resend(process.env.RESEND_API_KEY)

const TO = ['jfishback@simonexpress.com', 'csimon@simonexpress.com', 'tsimon@simonexpress.com', 'simon@link-x.com']

const CC_MAP = {
  jaden:  ['jsimon@simonexpress.com'],
  jordan: ['jordan@simonexpress.com'],
  split:  ['jsimon@simonexpress.com', 'jordan@simonexpress.com'],
  luis:   [],
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
function text(page, str, x, y, size, font, color) {
  if (!str) return
  page.drawText(String(str), { x, y, size: size || 10, font, color: color || BLACK })
}
function wrapText(str, font, size, maxW) {
  const words = String(str || '').split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (font.widthOfTextAtSize(test, size) > maxW) {
      if (line) lines.push(line)
      line = w
    } else line = test
  }
  if (line) lines.push(line)
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
  const { personKey, personName, unitNumber, lineItems, rateType, flatAmount, hourlyRate, totalAmount, photos } = data
  const dateCompleted = fmtDate(data.dateCompleted)

  const pdfDoc  = await PDFDocument.create()
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const W = 612, H = 792, ML = 48, MR = 48, MT = 48
  const CW = W - ML - MR

  const p1 = pdfDoc.addPage([W, H])
  let y = H - MT

  // Title
  text(p1, 'WORK ORDER INVOICE', ML, y, 22, bold, NAVY)
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const invLabel = 'Invoice #: ' + invoiceNum
  text(p1, invLabel, W - MR - bold.widthOfTextAtSize(invLabel, 10), y, 10, bold, MGRAY)
  y -= 16
  const dateLabel = 'Date: ' + dateStr
  text(p1, dateLabel, W - MR - regular.widthOfTextAtSize(dateLabel, 9), y, 9, regular, MGRAY)
  y -= 8
  drawLine(p1, ML, y, W - MR, y, RED, 2)
  y -= 20

  // PAY TO / INVOICE TO boxes
  const boxH = 100, boxW = (CW - 16) / 2
  drawRect(p1, ML, y - boxH, boxW, boxH, LGRAY, BORDER, 0.75)
  text(p1, 'PAY TO:', ML + 10, y - 14, 8, bold, MGRAY)
  text(p1, personName, ML + 10, y - 30, 12, bold, NAVY)
  if (rateType === 'hourly' && hourlyRate) text(p1, 'Rate: $' + parseFloat(hourlyRate).toFixed(2) + '/hr', ML + 10, y - 48, 9, regular, DGRAY)
  if (rateType === 'flat') text(p1, 'Flat Rate', ML + 10, y - 48, 9, regular, DGRAY)

  const rx = ML + boxW + 16
  drawRect(p1, rx, y - boxH, boxW, boxH, WHITE, BORDER, 0.75)
  text(p1, 'INVOICE TO:', rx + 10, y - 14, 8, bold, MGRAY)
  text(p1, 'Simon Express', rx + 10, y - 30, 12, bold, NAVY)
  text(p1, 'PO Box 1582', rx + 10, y - 46, 9, regular, DGRAY)
  text(p1, 'Riverton, UT 84065', rx + 10, y - 59, 9, regular, DGRAY)
  text(p1, 'Phone: 801-260-7010', rx + 10, y - 72, 9, regular, DGRAY)
  y -= boxH + 20

  // Job details strip
  drawRect(p1, ML, y - 26, CW, 26, NAVY, undefined)
  text(p1, 'Unit: ' + unitNumber, ML + 10, y - 17, 9, bold, WHITE)
  text(p1, 'Date Completed: ' + dateCompleted, ML + 130, y - 17, 9, bold, WHITE)
  if (personKey === 'split') {
    const spLabel = 'SPLIT PAY INVOICE'
    text(p1, spLabel, W - MR - bold.widthOfTextAtSize(spLabel, 8) - 10, y - 17, 8, bold, rgb(0.4, 0.7, 1.0))
  }
  y -= 26

  // Line items table header
  const COL_DESC = ML, COL_HRS = W - MR - 180, COL_RATE = W - MR - 100, COL_AMT = W - MR - 10, RROW = 22
  drawRect(p1, ML, y - RROW, CW, RROW, LGRAY, BORDER, 0.5)
  text(p1, 'DESCRIPTION', COL_DESC + 8, y - 15, 8, bold, MGRAY)
  text(p1, 'HRS',         COL_HRS,      y - 15, 8, bold, MGRAY)
  text(p1, 'RATE',        COL_RATE,     y - 15, 8, bold, MGRAY)
  const amtW = bold.widthOfTextAtSize('AMOUNT', 8)
  text(p1, 'AMOUNT', COL_AMT - amtW, y - 15, 8, bold, MGRAY)
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
    drawRect(p1, ML, y - 24, CW, 24, rowBg, BORDER, 0.5)
    wrapText(item.description || '', regular, 9, COL_HRS - COL_DESC - 16).slice(0, 2).forEach(function(l, li) {
      text(p1, l, COL_DESC + 8, y - 10 - li * 11, 9, regular, BLACK)
    })

    // HRS col: always show if entered; grey if using flat rate
    text(p1, hrs > 0 ? hrs.toFixed(2) : '-', COL_HRS, y - 10, 9, regular, useFlatRate ? MGRAY : BLACK)
    // RATE col: show hourly rate if using hourly, dash if flat
    if (!useFlatRate && rateType === 'hourly' && hourlyRateVal > 0) {
      text(p1, '$' + hourlyRateVal.toFixed(2), COL_RATE, y - 10, 9, regular, BLACK)
    } else {
      text(p1, '-', COL_RATE, y - 10, 9, regular, MGRAY)
    }
    // AMOUNT col
    const amtStr = lineAmt > 0 ? '$' + lineAmt.toFixed(2) : '-'
    const aw = regular.widthOfTextAtSize(amtStr, 9)
    text(p1, amtStr, COL_AMT - aw, y - 10, 9, regular, BLACK)
    y -= 24
  })

  // Totals
  y -= 10
  drawLine(p1, COL_RATE - 20, y, W - MR, y, BORDER, 0.75)
  y -= 16
  const effectiveTotal = rateType === 'flat' ? parseFloat(flatAmount || totalAmount || grandTotal) : grandTotal
  const totalStr = '$' + effectiveTotal.toFixed(2)
  text(p1, 'TOTAL DUE', W - MR - bold.widthOfTextAtSize('TOTAL DUE', 9), y, 9, bold, MGRAY)
  y -= 26
  const tw = bold.widthOfTextAtSize(totalStr, 22)
  text(p1, totalStr, W - MR - tw, y, 22, bold, RED)
  y -= 40

  // Hourly summary bar
  if (rateType === 'hourly') {
    const totalHrs = items.reduce((s, i) => s + (parseFloat(i.hours) || 0), 0)
    const summaryStr = 'Total Hours: ' + totalHrs.toFixed(2) + '  x  $' + hourlyRateVal.toFixed(2) + '/hr  =  $' + grandTotal.toFixed(2)
    drawRect(p1, ML, y - 22, CW, 22, LGRAY, BORDER, 0.5)
    text(p1, summaryStr, ML + 10, y - 14, 9, regular, DGRAY)
    y -= 22
  }

  // Split pay block
  if (personKey === 'split') {
    const totalDue = effectiveTotal
    const splitAmt = totalDue / 2
    const splitStr = '$' + splitAmt.toFixed(2)
    y -= 10
    drawRect(p1, ML, y - 26, CW, 26, NAVY, undefined)
    text(p1, 'PAYMENT BREAKDOWN  -  50/50 SPLIT', ML + 10, y - 17, 9, bold, WHITE)
    const spW = bold.widthOfTextAtSize('SPLIT PAY INVOICE', 8)
    text(p1, 'SPLIT PAY INVOICE', W - MR - spW - 10, y - 17, 8, bold, rgb(0.4, 0.7, 1.0))
    y -= 26
    const bw = (CW - 10) / 2
    // Jaden box
    drawRect(p1, ML, y - 80, bw, 80, rgb(0.97, 0.97, 1.0), BORDER, 0.75)
    drawRect(p1, ML, y - 22, bw, 22, rgb(0.2, 0.2, 0.35), undefined)
    text(p1, 'PAY TO', ML + 8, y - 14, 7, bold, rgb(0.6, 0.7, 0.9))
    text(p1, 'Jaden Simon', ML + 8, y - 38, 11, bold, NAVY)
    text(p1, '50% of Total Invoice', ML + 8, y - 52, 8, regular, DGRAY)
    const jsw = bold.widthOfTextAtSize(splitStr, 18)
    text(p1, splitStr, ML + bw - jsw - 8, y - 68, 18, bold, RED)
    // Jordan box
    const rx2 = ML + bw + 10
    drawRect(p1, rx2, y - 80, bw, 80, rgb(0.97, 0.97, 1.0), BORDER, 0.75)
    drawRect(p1, rx2, y - 22, bw, 22, rgb(0.2, 0.2, 0.35), undefined)
    text(p1, 'PAY TO', rx2 + 8, y - 14, 7, bold, rgb(0.6, 0.7, 0.9))
    text(p1, 'Jordan Simon', rx2 + 8, y - 38, 11, bold, NAVY)
    text(p1, '50% of Total Invoice', rx2 + 8, y - 52, 8, regular, DGRAY)
    const jrw = bold.widthOfTextAtSize(splitStr, 18)
    text(p1, splitStr, rx2 + bw - jrw - 8, y - 68, 18, bold, RED)
    y -= 90
  }

  // Notes
  if (data.notes && data.notes.trim()) {
    y -= 14
    drawRect(p1, ML, y - 18, CW, 18, NAVY, undefined)
    text(p1, 'NOTES', ML + 10, y - 12, 8, bold, WHITE)
    y -= 18
    const noteLines = wrapText(data.notes.trim(), regular, 9.5, CW - 20)
    const notesBoxH = Math.max(36, noteLines.length * 14 + 16)
    drawRect(p1, ML, y - notesBoxH, CW, notesBoxH, LGRAY, BORDER, 0.5)
    noteLines.forEach(function(l, i) {
      const ly = y - 12 - i * 14
      if (ly > y - notesBoxH + 4) text(p1, l, ML + 10, ly, 9.5, regular, DGRAY)
    })
    y -= notesBoxH
  }

  // Photo note
  if (photos && photos.length > 0) {
    y -= 14
    text(p1, photos.length + ' photo' + (photos.length > 1 ? 's' : '') + ' attached - see following page' + (photos.length > 1 ? 's' : ''), ML, y, 8, oblique, MGRAY)
  }

  // Footer
  drawLine(p1, ML, 44, W - MR, 44, BORDER, 0.5)
  text(p1, 'Simon Express Work Order  |  ' + invoiceNum, ML, 30, 7.5, regular, MGRAY)
  text(p1, 'Page 1 of ' + ((photos ? photos.length : 0) + 1), W - MR - 60, 30, 7.5, regular, MGRAY)

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
        const base64 = photo.dataUrl.split(',')[1]
        const bytes  = Buffer.from(base64, 'base64')
        const isPng  = photo.dataUrl.startsWith('data:image/png')
        const img    = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
        const availW = W - ML - MR, availH = H - 110
        const scale  = Math.min(availW / img.width, availH / img.height, 1)
        pp.drawImage(img, { x: ML + (availW - img.width * scale) / 2, y: H - 72 - img.height * scale, width: img.width * scale, height: img.height * scale })
      } catch (_) {
        text(pp, '(Image could not be rendered)', ML, H - 200, 10, regular, MGRAY)
      }
      drawLine(pp, ML, 44, W - MR, 44, BORDER, 0.5)
      text(pp, 'Simon Express Work Order  |  ' + invoiceNum, ML, 30, 7.5, regular, MGRAY)
      text(pp, 'Page ' + (pi + 2) + ' of ' + (photos.length + 1), W - MR - 60, 30, 7.5, regular, MGRAY)
    }
  }

  return Buffer.from(await pdfDoc.save())
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { personKey, personName, otherEmail, unitNumber, lineItems, notes, rateType, flatAmount, hourlyRate, photos } = body
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

    // Invoice counter
    let invoiceNum = 'WO-0001'
    try {
      const ecId     = process.env.EDGE_CONFIG_ID
      const ecToken  = process.env.EDGE_CONFIG_TOKEN
      const apiToken = process.env.VERCEL_API_TOKEN
      const teamId   = process.env.VERCEL_TEAM_ID
      const readRes  = await fetch(`https://edge-config.vercel.com/${ecId}/item/invoiceCounter?token=${ecToken}`)
      const current  = readRes.ok ? (await readRes.json()) : 0
      const next     = (parseInt(current) || 0) + 1
      invoiceNum     = 'WO-' + String(next).padStart(4, '0')
      const teamParam = teamId ? `?teamId=${teamId}` : ''
      await fetch(`https://api.vercel.com/v1/edge-config/${ecId}/items${teamParam}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ operation: 'upsert', key: 'invoiceCounter', value: next }] }),
      })
    } catch (e) {
      console.error('Edge Config error:', e)
      invoiceNum = 'WO-' + Date.now().toString().slice(-6)
    }

    const pdfBuffer = await buildInvoicePdf({ ...body, dateCompleted, totalAmount, notes, flatAmount: effectiveFlatAmount }, invoiceNum)
    const pdfBase64 = pdfBuffer.toString('base64')
    const pdfName   = 'WorkOrder_' + (unitNumber || '').replace(/[^a-zA-Z0-9]/g, '_') + '_' + dateCompleted + '.pdf'

    // Email line item rows
    const itemRows = (lineItems || []).map((item, idx) => {
      const hrs        = parseFloat(item.hours) || 0
      const itemRate   = parseFloat(item.rate) || 0
      const useFlatRate = itemRate > 0
      const amt        = useFlatRate ? itemRate : (hrs * hourlyRateVal)
      return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9f9'}">
        <td style="padding:8px 12px;font-size:13px;color:#999;border-bottom:1px solid #f0f0f0;text-align:center;width:28px;">${idx + 1}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0;">${item.description || '-'}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center;border-bottom:1px solid #f0f0f0;">${hrs > 0 ? hrs.toFixed(2) : '-'}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:right;border-bottom:1px solid #f0f0f0;font-weight:600;">${amt > 0 ? '$' + amt.toFixed(2) : '-'}</td>
      </tr>`
    }).join('')

    // Split pay email block
    const splitPayHtml = personKey === 'split' ? `
    <div style="margin:20px 0;border-radius:8px;overflow:hidden;border:1px solid #ddd;">
      <div style="background:#1a1a2e;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Payment Breakdown - 50/50 Split</span>
        <span style="color:#66b3ff;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SPLIT PAY INVOICE</span>
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

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:28px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #ddd;">
  <div style="background:#111;"><div style="background:#CC0000;height:4px;"></div>
    <div style="padding:16px 24px;">
      <span style="font-size:18px;font-weight:700;color:#fff;letter-spacing:1px;text-transform:uppercase;">Simon Express</span>
      <span style="display:block;font-size:10px;color:#9aafca;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Work Order Invoice - ${invoiceNum}</span>
    </div>
  </div>
  <div style="padding:24px;">
    <table style="width:100%;margin-bottom:20px;border-collapse:collapse;">
      <tr>
        <td style="width:48%;vertical-align:top;background:#f5f5f5;border:1px solid #ddd;border-radius:6px;padding:12px;">
          <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Pay To</div>
          <div style="font-size:15px;font-weight:700;color:#1a1a2e;">${personName}</div>
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
      <span><strong>Unit:</strong> ${unitNumber}</span>
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
    </div>
    ${splitPayHtml}
    ${notes && notes.trim() ? `<div style="margin-bottom:4px;"><div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Notes</div><div style="background:#f8f8f8;border-left:3px solid #ddd;padding:10px 14px;border-radius:0 6px 6px 0;font-size:13px;line-height:1.6;color:#444;white-space:pre-wrap;">${notes.trim()}</div></div>` : ''}
    ${photos && photos.length > 0 ? `<p style="font-size:12px;color:#aaa;margin-top:16px;margin-bottom:0;">${photos.length} photo${photos.length > 1 ? 's' : ''} attached - see PDF.</p>` : ''}
  </div>
  <div style="padding:14px 24px;border-top:1px solid #f0f0f0;text-align:center;">
    <p style="font-size:11px;color:#aaa;margin:0;">Simon Express Work Order System - ${invoiceNum}</p>
  </div>
</div></body></html>`

    const { data, error } = await resend.emails.send({
      from: 'Simon Express Work Orders <tickets@simonexpress.com>',
      to: TO,
      cc: ccList.length > 0 ? ccList : undefined,
      subject: 'Work Order - ' + unitNumber + ' - ' + personName + ' - ' + dateCompleted,
      html,
      attachments: [{ filename: pdfName, content: pdfBase64 }],
    })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, id: data.id })
  } catch (err) {
    console.error(err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
