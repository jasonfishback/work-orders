import './globals.css'
import Link from 'next/link'

export const metadata = { title: 'Simon Express — Shop' }

// Home: two big thumb targets. No login here — the check-in page has its own PIN.
export default function HomePage() {
  return (
    <>
      <header className="hdr">
        <img src="/logo.png" alt="Simon Express" className="logo" />
        <p className="tagline">Shop</p>
      </header>
      <div className="home">
        <Link href="/work-order" className="home-btn">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          <span className="home-btn-title">Submit Work Order</span>
          <span className="home-btn-sub">Invoice for completed work</span>
        </Link>
        <Link href="/check-in" className="home-btn home-btn-alt">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
          <span className="home-btn-title">Equipment Check In</span>
          <span className="home-btn-sub">Quick inspection · red tags · photos</span>
        </Link>
      </div>
    </>
  )
}
