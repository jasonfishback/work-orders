'use client'
import '../globals.css'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// Equipment Check In — quick yard inspection. Built for thumbs on an iPad/iPhone:
// big buttons, one screen, few taps. PIN-gated (remembered per device).


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

const USER_KEY = 'se_checkin_user'
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

/* ---------------- Name gate ---------------- */
function NameGate({ onOk }) {
  const [name, setName] = useState('')
  const [bad, setBad] = useState(false)
  const [checking, setChecking] = useState(false)
  async function go() {
    const n = name.trim()
    if (!n) return
    setChecking(true); setBad(false)
    try {
      const r = await fetch('/api/unit-history?ping=1', { headers: { 'x-checkin-user': n } })
      if (r.status === 401) { setBad(true); return }
      const j = await r.json()
      const canon = j.user || n
      try { localStorage.setItem(USER_KEY, canon) } catch {}
      onOk(canon)
    } catch { setBad(true) } finally { setChecking(false) }
  }
  return (
    <div className="body">
      <div className="pin-wrap">
        <p className="pin-title">Who are you?</p>
        <p className="pin-hint">Type your first name</p>
        <input className="unit-input" style={{ marginTop: 16, letterSpacing: 1 }} type="text" autoFocus autoComplete="off" autoCapitalize="words" autoCorrect="off"
          placeholder="First name" value={name} onChange={e => { setName(e.target.value); setBad(false) }} onKeyDown={e => { if (e.key === 'Enter') go() }} />
        {bad && <p className="pin-bad" style={{ marginTop: 8 }}>That name isn&rsquo;t on the shop list.</p>}
        <button className="sub-btn" style={{ marginTop: 14 }} onClick={go} disabled={checking || !name.trim()}>{checking ? 'Checking…' : 'Continue'}</button>
      </div>
    </div>
  )
}

/* ---------------- Page ---------------- */
export default function CheckInPage() {
  const [user, setUser] = useState(null)
  useEffect(() => { try { const u = localStorage.getItem(USER_KEY); if (u) setUser(u) } catch {} }, [])
  if (!user) {
    return (
      <>
        <header className="hdr">
          <Link href="/" className="hdr-back" aria-label="Home">&#8249; Home</Link>
          <img src="/logo.png" alt="Simon Express" className="logo" />
          <p className="tagline">Equipment Check In</p>
        </header>
        <NameGate onOk={setUser} />
      </>
    )
  }
  return <CheckInForm user={user} onLogout={() => { try { localStorage.removeItem(USER_KEY) } catch {}; setUser(null) }} />
}

function CheckInForm({ user, onLogout }) {
  const tech = user
  const onBadPin = onLogout
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
  const [videos, setVideos] = useState([])      // general videos [{storage_path,name,size}]
  const [uploading, setUploading] = useState(0) // in-flight direct uploads
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)
  const [errors, setErrors] = useState([])
  const nextId = useRef(1)
  const fileRefs = useRef({})
  const unitTimer = useRef(null)
  const lastFetched = useRef('')

  const hdrs = { 'x-checkin-user': user }

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
    setItems(prev => [...prev, { id: nextId.current++, key: c.key, label: c.label, category: c.category, notes: '', redTag: false, driverFault: false, positions: [], positionNotes: {}, photos: [], videos: [] }])
  }
  function addCustom() {
    const name = customName.trim()
    if (!name) return
    setItems(prev => [...prev, { id: nextId.current++, key: 'custom-' + nextId.current, label: name, category: 'other', notes: '', redTag: false, driverFault: false, positions: [], positionNotes: {}, photos: [], videos: [] }])
    setCustomName(''); setAddingCustom(false)
  }
  const upd = (id, patch) => setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  const togglePos = (id, pos) => setItems(prev => prev.map(i => i.id !== id ? i : { ...i, positions: (i.positions || []).includes(pos) ? i.positions.filter(p => p !== pos) : [...(i.positions || []), pos] }))
  const setPosNote = (id, pos, val) => setItems(prev => prev.map(i => i.id !== id ? i : { ...i, positionNotes: { ...(i.positionNotes || {}), [pos]: val } }))
  const isTruck = !!(info && info.found && /truck|tractor/i.test(String(info.summary && info.summary.type || '')))
  const removeItem = (id) => setItems(prev => prev.filter(i => i.id !== id))

  // Videos go straight to kpi storage via a one-shot signed URL (bypasses the
  // 4.5MB API body limit). Returns {storage_path, name, size} or throws.
  async function uploadDirect(file) {
    const r = await fetch('/api/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json', ...hdrs },
      body: JSON.stringify({ unit: unit.trim() || 'unknown', name: file.name, contentType: file.type || 'video/mp4' }) })
    if (r.status === 401) { onBadPin(); throw new Error('PIN') }
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'upload not allowed')
    const put = await fetch(j.signedUrl, { method: 'PUT', headers: { 'Content-Type': j.contentType }, body: file })
    if (!put.ok) throw new Error('upload failed (' + put.status + ')')
    return { storage_path: j.path, name: j.name, size: file.size }
  }
  const MAX_VIDEO = 50 * 1024 * 1024
  function onVideos(e, itemId) {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('video/'))
    e.target.value = ''
    files.forEach(async function (file) {
      if (file.size > MAX_VIDEO) { setErrors(er => [...er, `${file.name} is over 50MB — keep videos under about a minute.`]); return }
      setUploading(n => n + 1)
      try {
        const v = await uploadDirect(file)
        if (itemId == null) setVideos(p => [...p, v])
        else setItems(prev => prev.map(i => i.id === itemId ? { ...i, videos: [...(i.videos || []), v] } : i))
      } catch (err) {
        setErrors(er => [...er, 'Video upload failed: ' + (err.message || 'try again')])
      } finally { setUploading(n => n - 1) }
    })
  }

  function onItemPhotos(id, e) {
    const files = Array.from(e.target.files)
    if (files.some(f => f.type.startsWith('video/'))) onVideos({ target: { files: files.filter(f => f.type.startsWith('video/')), value: '' } }, id)
    files.forEach(function (file) {
      if (!file.type.startsWith('image/')) return
      compressImage(file).then(function (ph) { setItems(prev => prev.map(i => i.id === id ? { ...i, photos: [...i.photos, ph] } : i)) })
    })
    e.target.value = ''
  }
  function onGeneralPhotos(e) {
    const files = Array.from(e.target.files)
    if (files.some(f => f.type.startsWith('video/'))) onVideos({ target: { files: files.filter(f => f.type.startsWith('video/')), value: '' } }, null)
    files.forEach(function (file) {
      if (!file.type.startsWith('image/')) return
      compressImage(file).then(function (ph) { setPhotos(p => [...p, ph]) })
    })
    e.target.value = ''
  }
  const pick = (refKey) => { const el = fileRefs.current[refKey]; if (el) el.click() }

  function validate(clean) {
    const errs = []
    if (!unit.trim()) errs.push('Enter the unit number.')
    if (!clean && !items.length && !notes.trim()) errs.push('Tap at least one item, add a note, or mark it Clean.')
    return errs
  }

  async function submit(clean = false) {
    setErrors([])
    const errs = validate(clean)
    if (uploading > 0) errs.push('Wait for the video upload to finish.')
    if (errs.length) { setErrors(errs); return }
    const payload = {
      unit: unit.trim(), checkedInBy: tech, checkedInAt: new Date().toISOString(),
      driverName: driver.trim() || null,
      driverSource: info && info.driver && info.driver.name === driver.trim() ? info.driver.source : (driver.trim() ? 'entered' : null),
      unitSummary: info ? { summary: info.summary, inspection: info.inspection, odometer: info.odometer } : null,
      driverCode: info && info.driver && info.driver.name === driver.trim() ? (info.driver.code || null) : null,
      items: items.map(i => ({ category: i.category, label: i.label, notes: i.notes, redTag: i.redTag, driverFault: i.driverFault, positions: i.positions || [], positionNotes: i.positionNotes || {}, photos: i.photos, videos: i.videos || [] })),
      notes, photos, videos, clean,
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
    setItems([]); setNotes(''); setPhotos([]); setVideos([]); setErrors([]); setDone(null)
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

        <div className="who-strip">
          <span>Checking in as <b>{user}</b></span>
          <button className="who-switch" onClick={onLogout}>Not you?</button>
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
                  {(it.positions || []).length > 0 && (
                    <div className="pos-notes">
                      <div className="pos-lbl" style={{ marginTop: 10 }}>Notes per tire</div>
                      {[...STEER_POS, ...DUAL_POS].filter(p => it.positions.includes(p)).map(p => (
                        <div key={p} className="pos-note-row">
                          <span className="pos-note-tag">{p}</span>
                          <input className="pos-note-in" placeholder={`What's wrong with ${p}?`} value={(it.positionNotes || {})[p] || ''} onChange={e => setPosNote(it.id, p, e.target.value)} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <textarea className="item-notes" placeholder={`Notes for ${it.label.toLowerCase()}…`} value={it.notes} onChange={e => upd(it.id, { notes: e.target.value })} />
              <div className="item-actions">
                <input ref={el => { fileRefs.current['cam' + it.id] = el }} type="file" accept="image/*" capture="environment" onChange={e => onItemPhotos(it.id, e)} style={{ display: 'none' }} />
                <input ref={el => { fileRefs.current['lib' + it.id] = el }} type="file" accept="image/*,video/*" multiple onChange={e => onItemPhotos(it.id, e)} style={{ display: 'none' }} />
                <input ref={el => { fileRefs.current['vid' + it.id] = el }} type="file" accept="video/*" capture="environment" onChange={e => onVideos(e, it.id)} style={{ display: 'none' }} />
                <button className="act-btn" onClick={() => pick('cam' + it.id)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  Take Photo
                </button>
                <button className="act-btn" onClick={() => pick('lib' + it.id)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                  Photos
                </button>
                <button className="act-btn" onClick={() => pick('vid' + it.id)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
                  Video
                </button>
                <button className={'act-btn red-tag' + (it.redTag ? ' on' : '')} onClick={() => upd(it.id, { redTag: !it.redTag })}>
                  <span className="rt-box">{it.redTag ? '✓' : ''}</span> Red Tag
                </button>
              </div>
              <button className={'fault-btn' + (it.driverFault ? ' on' : '')} onClick={() => upd(it.id, { driverFault: !it.driverFault })}>
                <span className="rt-box">{it.driverFault ? '✓' : ''}</span> Driver Fault
                <span className="fault-sub">{it.driverFault ? 'caused by the driver' : 'off = normal wear & tear'}</span>
              </button>
              {(it.videos || []).length > 0 && (
                <div className="vids">
                  {it.videos.map((v, i) => (
                    <span key={i} className="vid-chip">▶ {v.name} <button className="vid-rm" onClick={() => upd(it.id, { videos: it.videos.filter((_, idx) => idx !== i) })}>×</button></span>
                  ))}
                </div>
              )}
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
              <input ref={el => { fileRefs.current['glib'] = el }} type="file" accept="image/*,video/*" multiple onChange={onGeneralPhotos} style={{ display: 'none' }} />
              <input ref={el => { fileRefs.current['gvid'] = el }} type="file" accept="video/*" capture="environment" onChange={e => onVideos(e, null)} style={{ display: 'none' }} />
              <button className="act-btn" onClick={() => pick('gcam')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Take Photo
              </button>
              <button className="act-btn" onClick={() => pick('glib')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                Photos
              </button>
              <button className="act-btn" onClick={() => pick('gvid')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
                Video
              </button>
            </div>
            {videos.length > 0 && (
              <div className="vids">
                {videos.map((v, i) => (
                  <span key={i} className="vid-chip">▶ {v.name} <button className="vid-rm" onClick={() => setVideos(vs => vs.filter((_, idx) => idx !== i))}>×</button></span>
                ))}
              </div>
            )}
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
          {uploading > 0 && <div className="uploading">Uploading {uploading} video{uploading > 1 ? 's' : ''}…</div>}
          {items.length > 0 || notes.trim() || photos.length > 0 || videos.length > 0 ? (
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
