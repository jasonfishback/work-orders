'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Fixed bottom bar for the home-screen (standalone) app, where iOS hides the
// browser chrome — gives the shop guys Home / Work Order / Check In / Start Over
// from anywhere. Padded for the iPhone home indicator (safe-area inset).
export default function BottomNav() {
  const path = usePathname() || '/'
  const is = (p) => (p === '/' ? path === '/' : path.startsWith(p))
  function startOver() {
    // Full reload of the current form = clean slate (state lives in memory only).
    if (typeof window !== 'undefined') window.location.href = path === '/' ? '/' : path
  }
  return (
    <nav className="bnav" aria-label="App navigation">
      <Link href="/" className={'bnav-btn' + (is('/') ? ' on' : '')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg>
        Home
      </Link>
      <Link href="/work-order" className={'bnav-btn' + (is('/work-order') ? ' on' : '')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        Work Order
      </Link>
      <Link href="/check-in" className={'bnav-btn' + (is('/check-in') ? ' on' : '')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
        Check In
      </Link>
      {path !== '/' && (
        <button type="button" className="bnav-btn bnav-reset" onClick={startOver}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
          Start Over
        </button>
      )}
    </nav>
  )
}
