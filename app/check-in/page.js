'use client'
import '../globals.css'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// Equipment Check In — quick yard inspection. Built for thumbs on an iPad/iPhone:
// big buttons, one screen, few taps. PIN-gated (remembered per device).

const TECHS = ['Jaden', 'Jordan', 'Rusty', 'Jason', 'TeJay']

// Category tiles. `category` = kpi maintenance category id so the record
// lines up with the rest of the maintenance history.
const CATS = [
  { key: 'brakes',     label: 'Brakes',                 category: 'brakes' },
  { key: 'tires',      label: 'Tires',                  category: 'tires' },
  { key: 'air',        label: 'Air System / Suspension', category: 'suspension' },
  { key: 'grease',     label: 'Grease / Lube',          category: 'pm_oil' },
  { key: 'body',       label: 'Body Damage',            category: 'body_glass' },
  { key: 'doors',      label: 'Doors',                  category: 'body_glass' },
  { key: 'windshield', label: 'Windshield',             category: 'body_glass' },
  { key: 'interior',   label: 'Interior',               category: 'other' },
]

// Tire positions. Trailer: 8 duals. Truck: Steer Left / Steer Right + 8 drive duals.
const DUAL_POS = ['LFI', 'LFO', 'LRI', 'LRO', 'RFI', 'RFO', 'RRI', 'RRO']
const STEER_POS = ['Steer Left', 'Steer Right']

const PIN_KEY = 'se_checkin_pin'
const MAX_PAYLOAD = 4 * 1024 * 1024 // Vercel function body limit is 4.5MB

function compressImage(file) {
  return new Promise(function (resolve) {
    var reader = new FileReader()
    reader.onload = function (ev) {
      var img = new Image()
      img.onload = function () {
        var MAX = 1280
        var w = img.width, h = img.height
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX }
          else { w = Math.round(w * MAX / h); h = MAX }
        }
        var canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve({ name: file.name, dataUrl: canvas.toDataURL('image/jpeg', 0.72) })
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  })
}

function fmtDate(iso) {
  if (!iso) return ''
  var p = String(iso).slice(0, 10).split('-')
  return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : iso
}

/* ---------------- PIN pad ---------------- */
function PinGate({ onOk }) {
  const [pin, setPin] = useState('')
  const [bad, setBad] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (pin.length !== 4) return
    setChecking(true)
    fetch('/api/unit-history?ping=1', { headers: { 'x-checkin-pin': pin } })
      .then(r => {
        if (r.status === 401) { setBad(true); setPin(''); return }
        try { localStorage.setItem(PIN_KEY, pin) } catch {}
        onOk(pin)
      })
      .catch(() => { setBad(true); setPin('') })
      .finally(() => setChecking(false))
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps

  const press = (d) => { setBad(false); if (pin.length < 4) setPin(pin + d) }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
  return (
    <div className="body">
      <div className="pin-wrap">
        <p className="pin-title">Enter PIN</p>
        <p className="pin-hint">Hint: last 4 of the shop phone</p>
        <div className="pin-dots">{[0, 1, 2, 3].map(i => <span key={i} className={'pin-dot' + (pin.length > i ? ' on' : '') + (bad ? ' bad' : '')} />)}</div>
        {bad && <p className="pin-bad">Wrong PIN — try again</p>}
        <div className="pin-grid">
          {keys.map((k, i) => k === '' ? <span key={i} /> : (
            <button key={i} className={'pin-key' + (k === '⌫' ? ' pin-key-del' : '')} disabled={checking}
              onClick={() => k === '⌫' ? setPin(pin.slice(0, -1)) : press(k)}>{k}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Page ---------------- */
export default function CheckInPage() {
  const [pin, setPin] = useState(null)
  useEffect(() => { try { const p = localStorage.getItem(PIN_KEY); if (p) setPin(p) } catch {} }, [])
  if (!pin) {
    return (
      <>
        <header className="hdr">
          <Link href="/" className="hdr-back" aria-label="Home">&#8249; Home</Link>
          <img src="/logo.png" alt="Simon Express" className="logo" />
          <p className="tagline">Equipment Check In</p>
        </header>
        <PinGate onOk={setPin} />
      </>
    )
  }
  return <CheckInForm pin={pin} onBadPin={() => { try { localStorage.removeItem(PIN_KEY) } catch {}; setPin(null) }} />
}

function CheckInForm({ pin, onBadPin }) {
  const [tech, setTech] = useState('')
  const [unit, setUnit] = useState('')
  const [info, setInfo] = useState(null)        // unit-history payload
  const [infoState, setInfoState] = useState('idle') // idle | loading | ok | error
  const [histOpen, setHistOpen] = useState(false)
  const [driver, setDriver] = useState('')      // resolved / overridden driver name
  const [editDriver, setEditDriver] = useState(false)
  const [items, setItems] = useState([])        // [{id,key,label,category,notes,redTag,photos:[]}]
  const [customName, setCustomName] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState([])      // general photos
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)
  const [errors, setErrors] = useState([])
  const nextId = useRef(1)
  const fileRefs = useRef({})
  const unitTimer = useRef(null)
  const lastFetched = useRef('')

  const hdrs = { 'x-checkin-pin': pin }

  // Look the unit up once the number settles (600ms after last keystroke).
  useEffect(() => {
    const u = unit.trim()
    clearTimeout(unitTimer.current)
    if (!u) { setInfo(null); setInfoState('idle'); setDriver(''); lastFetched.current = ''; return }
    unitTimer.current = setTimeout(() => lookup(u), 600)
    return () => clearTimeout(unitTimer.current)
  }, [unit]) // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup(u) {
    if (lastFetched.current === u && infoState === 'ok') return
    setInfoState('loading'); setHistOpen(false)
    try {
      const r = await fetch('/api/unit-history?unit=' + encodeURIComponent(u), { headers: hdrs, cache: 'no-store' })
      if (r.status === 401) { onBadPin(); return }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'lookup failed')
      lastFetched.current = u
      setInfo(j); setInfoState('ok')
      setDriver(j.driver && j.driver.name ? j.driver.name : '')
      setEditDriver(false)
    } catch (e) {
      setInfo(null); setInfoState('error')
    }
  }

  /* items */
  const has = (key) => items.some(i => i.key === key)
  function toggleCat(c) {
    if (has(c.key)) { setItems(prev => prev.filter(i => i.key !== c.key)); return }
    setItems(prev => [...prev, { id: nextId.current++, key: c.key, label: c.label, category: c.category, notes: '', redTag: false, driverFault: false, positions: [], photos: [] }])
  }
  function addCustom() {
    const name = customName.trim()
    if (!name) return
    setItems(prev => [...prev, { id: nextId.current++, key: 'custom-' + nextId.current, label: name, category: 'other', notes: '', redTag: false, driverFault: false, positions: [], photos: [] }])
    setCustomName(''); setAddingCustom(false)
  }
  const upd = (id, patch) => setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  const togglePos = (id, pos) => setItems(prev => prev.map(i => i.id !== id ? i : { ...i, positions: (i.positions || []).includes(pos) ? i.positions.filter(p => p !== pos) : [...(i.positions || []), pos] }))
  const isTruck = !!(info && info.found && /truck|tractor/i.test(String(info.summary && info.summary.type || '')))
  const removeItem = (id) => setItems(prev => prev.filter(i => i.id !== id))

  function onItemPhotos(id, e) {
    Array.from(e.target.files).forEach(function (file) {
      if (!file.type.startsWith('image/')) return
      compressImage(file).then(function (ph) { setItems(prev => prev.map(i => i.id === id ? { ...i, photos: [...i.photos, ph] } : i)) })
    })
    e.target.value = ''
  }
  function onGeneralPhotos(e) {
    Array.from(e.target.files).forEach(function (file) {
      if (!file.type.startsWith('image/')) return
      compressImage(file).then(function (ph) { setPhotos(p => [...p, ph]) })
    })
    e.target.value = ''
  }
  const pick = (refKey) => { const el = fileRefs.current[refKey]; if (el) el.click() }

  function validate(clean) {
    const errs = []
    if (!tech) errs.push('Tap your name.')
    if (!unit.trim()) errs.push('Enter the unit number.')
    if (!clean && !items.length && !notes.trim()) errs.push('Tap at least one item, add a note, or mark it Clean.')
    return errs
  }

  async function submit(clean = false) {
    setErrors([])
    const errs = validate(clean)
    if (errs.length) { setErrors(errs); return }
    const payload = {
      unit: unit.trim(), checkedInBy: tech, checkedInAt: new Date().toISOString(),
      driverName: driver.trim() || null,
      driverSource: info && info.driver && info.driver.name === driver.trim() ? info.driver.source : (driver.trim() ? 'entered' : null),
      unitSummary: info ? { summary: info.summary, inspection: info.inspection, odometer: info.odometer } : null,
      driverCode: info && info.driver && info.driver.name === driver.trim() ? (info.driver.code || null) : null,
      items: items.map(i => ({ category: i.category, label: i.label, notes: i.notes, redTag: i.redTag, driverFault: i.driverFault, positions: i.positions || [], photos: i.photos })),
      notes, photos, clean,
    }
    const body = JSON.stringify(payload)
    if (body.length > MAX_PAYLOAD) { setErrors(['Too many photos for one check-in — remove a few and try again.']); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/check-in', { method: 'POST', headers: { 'Content-Type': 'application/json', ...hdrs }, body })
      if (r.status === 401) { onBadPin(); return }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Server error')
      setDone({ unit: unit.trim(), redTags: j.red_tags || 0, clean })
    } catch (e) {
      setErrors([e.message || 'Something went wrong.'])
    } finally { setSubmitting(false) }
  }

  function reset() {
    setUnit(''); setInfo(null); setInfoState('idle'); setHistOpen(false); setDriver(''); setEditDriver(false)
    setItems([]); setNotes(''); setPhotos([]); setErrors([]); setDone(null)
  }

  const redCount = items.filter(i => i.redTag).length
  const insp = info && info.inspection

  if (done) {
    return (
      <>
        <header className="hdr">
          <Link href="/" className="hdr-back" aria-label="Home">&#8249; Home</Link>
          <img src="/logo.png" alt="Simon Express" className="logo" />
          <p className="tagline">Equipment Check In</p>
        </header>
        <div className="body">
          <div className="done-card">
            <div className="done-check">✓</div>
            <div className="done-title">Unit {done.unit} {done.clean ? 'marked clean' : 'checked in'}</div>
            <div className="done-sub">{done.clean ? 'Clean quick inspection saved for this unit and driver.' : done.redTags > 0 ? `${done.redTags} red tag${done.redTags > 1 ? 's' : ''} sent to the work list.` : 'Saved to the unit’s maintenance file.'}</div>
            <button className="sub-btn" onClick={reset}>Check In Another</button>
            <Link href="/" className="done-home">Back to home</Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="hdr">
        <Link href="/" className="hdr-back" aria-label="Home">&#8249; Home</Link>
        <img src="/logo.png" alt="Simon Express" className="logo" />
        <p className="tagline">Equipment Check In</p>
      </header>

      <div className="body">

        {/* 1. Who */}
        <div className="section-wrap">
          <p className="sec-lbl">Who&rsquo;s checking it in</p>
          <div className="tech-row">
            {TECHS.map(t => (
              <button key={t} className={'big-btn' + (tech === t ? ' on' : '')} onClick={() => setTech(t)}>{t}</button>
            ))}
          </div>
        </div>

        {/* 2. Unit */}
        <div className="section-wrap">
          <p className="sec-lbl">Unit number</p>
          <input className="unit-input" type="text" inputMode="numeric" autoComplete="off" placeholder="Truck or trailer #"
            value={unit} onChange={e => setUnit(e.target.value)} onBlur={() => unit.trim() && lookup(unit.trim())} />

          {infoState === 'loading' && <div className="unit-card muted">Looking up unit {unit.trim()}…</div>}
          {infoState === 'error' && <div className="unit-card muted">Couldn&rsquo;t reach kpi — you can still check it in.</div>}
          {infoState === 'ok' && info && (
            <div className="unit-card">
              <div className="unit-head">
                <div className="unit-num">Unit {info.unit}</div>
                <div className="unit-desc">
                  {info.found
                    ? [info.summary.year, info.summary.make, info.summary.model].filter(Boolean).join(' ') || info.summary.type || 'On file'
                    : 'Not in kpi yet'}
                </div>
              </div>

              <div className="unit-rows">
                <div className="unit-row">
                  <span className="unit-k">Driver on unit</span>
                  {editDriver ? (
                    <input className="driver-edit" autoFocus value={driver} onChange={e => setDriver(e.target.value)} onBlur={() => setEditDriver(false)} placeholder="Driver name" />
                  ) : (
                    <button className="unit-v unit-v-btn" onClick={() => setEditDriver(true)}>
                      {driver || 'Unknown'}{info.driver && info.driver.source === 'last_dispatched' && driver === info.driver.name ? <span className="unit-note"> · last dispatched</span> : null}
                      <span className="unit-edit">✎</span>
                    </button>
                  )}
                </div>
                <div className="unit-row">
                  <span className="unit-k">Inspection due</span>
                  <span className={'unit-v' + (insp ? (insp.status === 'overdue' ? ' red' : insp.status === 'due_soon' ? ' amber' : ' green') : '')}>
                    {insp ? `${fmtDate(insp.next_due)} · ${insp.days_until < 0 ? `${-insp.days_until} days OVERDUE` : `${insp.days_until} days`}` : 'No inspection on file'}
                  </span>
                </div>
                {info.odometer != null && (
                  <div className="unit-row"><span className="unit-k">Odometer</span><span className="unit-v">{Number(info.odometer).toLocaleString()} mi</span></div>
                )}
                {info.open_red_tags && info.open_red_tags.length > 0 && (
                  <div className="unit-row"><span className="unit-k">Open red tags</span><span className="unit-v red">{info.open_red_tags.length} — {info.open_red_tags.map(t => t.label).join(', ')}</span></div>
                )}
              </div>

              <button className={'hist-btn' + (histOpen ? ' open' : '')} onClick={() => setHistOpen(v => !v)}>
                {histOpen ? 'Minimize History' : `View Maintenance History (${info.record_count})`}
              </button>
              {histOpen && (
                <div className="hist">
                  {info.history.length === 0 && <div className="muted" style={{ padding: '8px 0' }}>No maintenance records for this unit.</div>}
                  {info.history.map(h => (
                    <div key={h.id} className="hist-row">
                      <div className="hist-top">
                        <span className="hist-date">{fmtDate(h.date) || '—'}</span>
                        <span className={'hist-tag' + (h.in_house ? ' inhouse' : '')}>{h.in_house ? 'In-house' : h.category_label}</span>
                        {h.vendor && !h.in_house && <span className="hist-vendor">{h.vendor}</span>}
                        <span className="hist-cost">{h.cost != null ? '$' + Math.round(h.cost).toLocaleString() : ''}</span>
                      </div>
                      <div className="hist-desc">{h.description || h.ro_number || ''}</div>
                    </div>
                  ))}
                  {info.checkins && info.checkins.length > 0 && (
                    <>
                      <p className="sec-lbl" style={{ marginTop: 12 }}>Previous check-ins</p>
                      {info.checkins.map(c => (
                        <div key={c.id} className="hist-row">
                          <div className="hist-top">
                            <span className="hist-date">{fmtDate(c.checked_in_at)}</span>
                            <span className="hist-tag">{c.checked_in_by}</span>
                            {c.driver_name && <span className="hist-vendor">driver {c.driver_name}</span>}
                          </div>
                          <div className="hist-desc">{(c.items || []).map(i => (i.red_tag ? '⛔ ' : '') + i.label).join(', ') || c.notes || ''}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Items */}
        <div className="section-wrap">
          <p className="sec-lbl">Tap what needs attention</p>
          <div className="cat-grid">
            {CATS.map(c => (
              <button key={c.key} className={'cat-btn' + (has(c.key) ? ' on' : '')} onClick={() => toggleCat(c)}>
                {has(c.key) && <span className="cat-check">✓</span>}{c.label}
              </button>
            ))}
            {addingCustom ? (
              <div className="cat-custom">
                <input autoFocus placeholder="Item name" value={customName} onChange={e => setCustomName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustom() }} />
                <button className="cat-custom-add" onClick={addCustom}>Add</button>
              </div>
            ) : (
              <button className="cat-btn cat-plus" onClick={() => setAddingCustom(true)}>+ Add Item</button>
            )}
          </div>

          {items.map(it => (
            <div key={it.id} className={'item-card' + (it.redTag ? ' red' : '')}>
              <div className="item-head">
                <span className="item-title">{it.label}</span>
                <button className="li-rm" onClick={() => removeItem(it.id)} title="Remove">×</button>
              </div>
              {it.key === 'tires' && (
                <button className={'pos-toggle' + (it.posOpen ? ' open' : '')} onClick={() => upd(it.id, { posOpen: !it.posOpen })}>
                  {it.posOpen ? 'Hide Tire Positions ▴' : ((it.positions || []).length ? `Tire Positions: ${it.positions.join(', ')} ▾` : 'Expand Tire Positions ▾')}
                </button>
              )}
              {it.key === 'tires' && it.posOpen && (
                <div className="pos-wrap">
                  {isTruck && (
                    <>
                      <div className="pos-lbl">Steers</div>
                      <div className="pos-grid pos-grid-2">
                        {STEER_POS.map(p => (
                          <button key={p} className={'pos-btn' + ((it.positions || []).includes(p) ? ' on' : '')} onClick={() => togglePos(it.id, p)}>{p}</button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="pos-lbl" style={isTruck ? { marginTop: 8 } : undefined}>{isTruck ? 'Drives' : 'Tire position · trailer'}</div>
                  <div className="pos-grid">
                    {DUAL_POS.map(p => (
                      <button key={p} className={'pos-btn' + ((it.positions || []).includes(p) ? ' on' : '')} onClick={() => togglePos(it.id, p)}>{p}</button>
                    ))}
                  </div>
                </div>
              )}
              <textarea className="item-notes" placeholder={`Notes for ${it.label.toLowerCase()}…`} value={it.notes} onChange={e => upd(it.id, { notes: e.target.value })} />
              <div className="item-actions">
                <input ref={el => { fileRefs.current['cam' + it.id] = el }} type="file" accept="image/*" capture="environment" onChange={e => onItemPhotos(it.id, e)} style={{ display: 'none' }} />
                <input ref={el => { fileRefs.current['lib' + it.id] = el }} type="file" accept="image/*" multiple onChange={e => onItemPhotos(it.id, e)} style={{ display: 'none' }} />
                <button className="act-btn" onClick={() => pick('cam' + it.id)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  Take Photo
                </button>
                <button className="act-btn" onClick={() => pick('lib' + it.id)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                  Photos
                </button>
                <button className={'act-btn red-tag' + (it.redTag ? ' on' : '')} onClick={() => upd(it.id, { redTag: !it.redTag })}>
                  <span className="rt-box">{it.redTag ? '✓' : ''}</span> Red Tag
                </button>
              </div>
              <button className={'fault-btn' + (it.driverFault ? ' on' : '')} onClick={() => upd(it.id, { driverFault: !it.driverFault })}>
                <span className="rt-box">{it.driverFault ? '✓' : ''}</span> Driver Fault
                <span className="fault-sub">{it.driverFault ? 'caused by the driver' : 'off = normal wear & tear'}</span>
              </button>
              {it.photos.length > 0 && (
                <div className="thumbs">
                  {it.photos.map((p, i) => (
                    <div key={i} className="thumb">
                      <img src={p.dataUrl} alt={p.name} />
                      <button className="thumb-rm" onClick={() => upd(it.id, { photos: it.photos.filter((_, idx) => idx !== i) })}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 4. Notes + overall photos */}
        <div className="section-wrap">
          <p className="sec-lbl">Anything else</p>
          <div className="card">
            <textarea className="item-notes" style={{ marginBottom: 10 }} placeholder="General notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
            <div className="item-actions">
              <input ref={el => { fileRefs.current['gcam'] = el }} type="file" accept="image/*" capture="environment" onChange={onGeneralPhotos} style={{ display: 'none' }} />
              <input ref={el => { fileRefs.current['glib'] = el }} type="file" accept="image/*" multiple onChange={onGeneralPhotos} style={{ display: 'none' }} />
              <button className="act-btn" onClick={() => pick('gcam')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Take Photo
              </button>
              <button className="act-btn" onClick={() => pick('glib')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                Photos
              </button>
            </div>
            {photos.length > 0 && (
              <div className="thumbs">
                {photos.map((p, i) => (
                  <div key={i} className="thumb">
                    <img src={p.dataUrl} alt={p.name} />
                    <button className="thumb-rm" onClick={() => setPhotos(ph => ph.filter((_, idx) => idx !== i))}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 5. Submit */}
        <div className="section-wrap" style={{ marginBottom: 32 }}>
          {items.length > 0 || notes.trim() ? (
            <>
              <button className="sub-btn" onClick={() => submit(false)} disabled={submitting}>
                {submitting ? 'Saving…' : `Submit Check In${redCount ? ` · ${redCount} Red Tag${redCount > 1 ? 's' : ''}` : ''}`}
              </button>
              <p className="dest-note">Saves to the unit&rsquo;s file on kpi{redCount ? ' · red tags go to the shop work list' : ''}</p>
            </>
          ) : (
            <>
              <button className="sub-btn clean-btn" onClick={() => submit(true)} disabled={submitting}>
                {submitting ? 'Saving…' : '✓ Clean — No Issues'}
              </button>
              <p className="dest-note">Records a clean quick inspection for this unit and its driver</p>
            </>
          )}
          {errors.length > 0 && <div className="err-box">{errors.map((e, i) => <div key={i}>! {e}</div>)}</div>}
        </div>

      </div>
    </>
  )
}
