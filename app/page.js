'use client'
import './globals.css'
import { useState, useRef } from 'react'

const CC_MAP = {
  jaden:  ['jsimon@simonexpress.com'],
  jordan: ['jordan@simonexpress.com'],
  split:  ['jsimon@simonexpress.com', 'jordan@simonexpress.com'],
  luis:   [],
  other:  [],
}

const NAME_MAP = {
  jaden:  'Jaden Simon',
  jordan: 'Jordan Simon',
  split:  'Jaden Simon / Jordan Simon Split',
  luis:   'Luis',
  other:  'Other',
}

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function TicketPage() {
  const [personKey,    setPersonKey]    = useState('')
  const [otherName,    setOtherName]    = useState('')
  const [otherEmail,   setOtherEmail]   = useState('')
  const [unitNumber,   setUnitNumber]   = useState('')
  const [dateCompleted,setDateCompleted]= useState(today())
  const [lineItems,    setLineItems]    = useState([{ id: 1, description: '', hours: '' }])
  const [notes,        setNotes]        = useState('')
  const [rateType,     setRateType]     = useState('flat')
  const [flatAmount,   setFlatAmount]   = useState('')
  const [hourlyRate,   setHourlyRate]   = useState('')
  const [photos,       setPhotos]       = useState([])
  const [submitting,   setSubmitting]   = useState(false)
  const [success,      setSuccess]      = useState(false)
  const [errors,       setErrors]       = useState([])
  const fileRef = useRef()
  const nextId  = useRef(2)

  const personName  = personKey === 'other' ? otherName : (NAME_MAP[personKey] || '')
  const ccAddresses = personKey === 'other'
    ? (otherEmail ? [otherEmail] : [])
    : (CC_MAP[personKey] || [])

  const totalHours = lineItems.reduce((s, i) => s + (parseFloat(i.hours) || 0), 0)
  const totalAmount = rateType === 'hourly'
    ? (totalHours * (parseFloat(hourlyRate) || 0)).toFixed(2)
    : parseFloat(flatAmount || 0).toFixed(2)
  const showTotal = parseFloat(totalAmount) > 0

  function addLine() {
    setLineItems(prev => [...prev, { id: nextId.current++, description: '', hours: '' }])
  }
  function removeLine(id) {
    setLineItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev)
  }
  function updateLine(id, field, val) {
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i))
  }

  function handlePhotos(e) {
    Array.from(e.target.files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = ev => setPhotos(p => [...p, { name: file.name, dataUrl: ev.target.result }])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  function validate() {
    const errs = []
    if (!unitNumber.trim()) errs.push('Unit Number is required.')
    if (!personKey) errs.push('Please select a person completing the work.')
    if (personKey === 'other' && !otherName.trim()) errs.push('Please enter the name.')
    if (personKey === 'other' && !otherEmail.trim()) errs.push('Please enter an email for the CC.')
    if (personKey === 'other' && otherEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(otherEmail)) errs.push('Please enter a valid email address.')
    if (!dateCompleted) errs.push('Date Completed is required.')
    if (!lineItems.some(i => i.description.trim())) errs.push('At least one work description is required.')
    if (rateType === 'flat' && !(parseFloat(flatAmount) > 0)) errs.push('Please enter a flat rate amount.')
    return errs
  }

  async function handleSubmit() {
    setErrors([]); setSuccess(false)
    const errs = validate()
    if (errs.length) { setErrors(errs); return }
    setSubmitting(true)

    try {
      const res = await fetch('/api/submit-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personKey, personName, otherEmail: personKey === 'other' ? otherEmail : null,
          unitNumber: unitNumber.trim(), dateCompleted,
          lineItems, notes,
          rateType,
          flatAmount: rateType === 'flat' ? flatAmount : null,
          hourlyRate: rateType === 'hourly' ? hourlyRate : null,
          photos,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Server error')
      setSuccess(true)
      setUnitNumber(''); setPersonKey(''); setOtherName(''); setOtherEmail('')
      setDateCompleted(today()); setLineItems([{ id: nextId.current++, description: '', hours: '' }])
      setRateType('flat'); setFlatAmount(''); setHourlyRate(''); setPhotos([]); setNotes('')
    } catch (err) {
      setErrors([err.message || 'Something went wrong.'])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <header className="hdr">
        <img src="/logo.png" alt="Simon Express" className="logo" />
        <p className="tagline">Work Order Submission</p>
      </header>

      <div className="body">

        {/* Unit */}
        <div className="section-wrap">
          <p className="sec-lbl">Unit Information</p>
          <div className="card">
            <div className="field">
              <label>Unit Number (Truck or Trailer #) <span className="req">*</span></label>
              <input type="text" placeholder="e.g. 25 or 53837" value={unitNumber} onChange={e => setUnitNumber(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Person */}
        <div className="section-wrap">
          <p className="sec-lbl">Person(s) Completing Work</p>
          <div className="card">
            <div className="field">
              <label>Select Person(s) Completing Work <span className="req">*</span></label>
              <select value={personKey} onChange={e => { setPersonKey(e.target.value); setOtherName(''); setOtherEmail('') }}>
                <option value="">-- Select --</option>
                <option value="jaden">Jaden Simon</option>
                <option value="jordan">Jordan Simon</option>
                <option value="split">Jaden Simon / Jordan Simon Split</option>
                <option value="luis">Luis</option>
                <option value="other">Other</option>
              </select>
            </div>
            {ccAddresses.length > 0 && (
              <div className="cc-chips">
                {ccAddresses.map(e => (
                  <span key={e} className="cc-chip">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    CC: {e}
                  </span>
                ))}
              </div>
            )}
            {personKey === 'other' && (
              <>
                <div className="field" style={{ marginTop: '12px' }}>
                  <label>Name <span className="req">*</span></label>
                  <input type="text" placeholder="Enter full name" value={otherName} onChange={e => setOtherName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Email â will be CC'd <span className="req">*</span></label>
                  <input type="email" inputMode="email" placeholder="email@example.com" value={otherEmail} onChange={e => setOtherEmail(e.target.value)} />
                  {otherEmail && (
                    <div className="cc-chips" style={{ marginTop: '6px' }}>
                      <span className="cc-chip">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        CC: {otherEmail}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Date */}
        <div className="section-wrap">
          <p className="sec-lbl">Date Completed</p>
          <div className="card">
            <div className="field">
              <label>Date <span className="req">*</span></label>
              <input type="date" value={dateCompleted} onChange={e => setDateCompleted(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="section-wrap">
          <p className="sec-lbl">Work Description</p>
          <div className="card">
            <div className="line-header">
              <span className="sec-lbl" style={{ margin: 0 }}>Line Items <span className="req">*</span></span>
              <span className="col-hint">Description Â· Hours</span>
            </div>
            <div className="line-items">
              {lineItems.map(item => (
                <div key={item.id} className="line-item">
                  <input className="li-desc" type="text" placeholder="e.g. Brakes"
                    value={item.description} onChange={e => updateLine(item.id, 'description', e.target.value)} />
                  <div className="li-hrs-wrap">
                    <span className="li-hrs-lbl">Hrs</span>
                    <input className="li-hrs" type="number" inputMode="decimal" placeholder="0" min="0" step="0.25"
                      value={item.hours} onChange={e => updateLine(item.id, 'hours', e.target.value)} />
                  </div>
                  <button className="li-rm" onClick={() => removeLine(item.id)} title="Remove">Ã</button>
                </div>
              ))}
            </div>
            <button className="add-line-btn" onClick={addLine}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Line Item
            </button>
            {totalHours > 0 && (
              <div className="hours-total-bar">
                <span className="hours-total-lbl">Total Hours</span>
                <span className="hours-total-val">{totalHours % 1 === 0 ? totalHours.toFixed(0) : totalHours.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="section-wrap">
          <p className="sec-lbl">Notes</p>
          <div className="card">
            <div className="field">
              <label>Additional Notes</label>
              <textarea
                placeholder="Any additional notes, special instructions, or comments..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                style={{ minHeight: '80px' }}
              />
            </div>
          </div>
        </div>

        {/* Photos */}
        <div className="section-wrap">
          <p className="sec-lbl">Photos</p>
          <div className="card">
            <div className="upload-zone" onClick={() => fileRef.current.click()}>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotos} style={{ display: 'none' }} />
              <div className="upload-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c00" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </div>
              <p className="upload-title">Tap to photograph or upload</p>
              <p className="upload-sub">Images Â· Multiple photos OK</p>
            </div>
            {photos.length > 0 && (
              <div className="thumbs">
                {photos.map((p, i) => (
                  <div key={i} className="thumb">
                    <img src={p.dataUrl} alt={p.name} />
                    <button className="thumb-rm" onClick={() => setPhotos(ph => ph.filter((_, idx) => idx !== i))}>Ã</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Labor */}
        <div className="section-wrap">
          <p className="sec-lbl">Labor &amp; Rate</p>
          <div className="card">
            <div className="field">
              <label>Rate Type</label>
              <div className="rate-row">
                <button className={'rate-btn' + (rateType === 'flat' ? ' on' : '')} onClick={() => setRateType('flat')}>Flat Rate</button>
                <button className={'rate-btn' + (rateType === 'hourly' ? ' on' : '')} onClick={() => setRateType('hourly')}>Hourly</button>
              </div>
            </div>
            {rateType === 'flat' && (
              <div className="rate-inner">
                <div className="field">
                  <label>Flat Rate Amount</label>
                  <div className="currency-wrap">
                    <span className="currency-sym">$</span>
                    <input type="number" inputMode="decimal" placeholder="0.00" min="0" step="0.01"
                      value={flatAmount} onChange={e => setFlatAmount(e.target.value)} />
                  </div>
                </div>
                {parseFloat(flatAmount) > 0 && (
                  <div className="price-bar">
                    <div className="price-lbl">Flat Rate Total</div>
                    <div className="price-val">${parseFloat(flatAmount).toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}
            {rateType === 'hourly' && (
              <div className="rate-inner">
                <div className="field">
                  <label>Hourly Rate ($)</label>
                  <div className="currency-wrap">
                    <span className="currency-sym">$</span>
                    <input type="number" inputMode="decimal" placeholder="0.00" min="0" step="0.01"
                      value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
                  </div>
                </div>
                <div className="price-bar">
                  <div>
                    <div className="price-lbl">Estimated Total</div>
                    <div className="price-note">
                      {showTotal ? `${totalHours} hrs Ã $${parseFloat(hourlyRate).toFixed(2)}/hr` : 'Add hours to line items above'}
                    </div>
                  </div>
                  <div className="price-val">{showTotal ? `$${totalAmount}` : 'â'}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="section-wrap" style={{ marginBottom: '24px' }}>
          <button className="sub-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
                Submit Work Order
              </>
            )}
          </button>
          <p className="dest-note">Sends to: jfishback@simonexpress.com Â· CC: person who completed work</p>
          {errors.length > 0 && (
            <div className="err-box">{errors.map((e, i) => <div key={i}>â  {e}</div>)}</div>
          )}
          {success && (
            <div className="ok-box">Work order submitted! The team has been notified and a PDF invoice has been emailed.</div>
          )}
        </div>

      </div>
    </>
  )
}
