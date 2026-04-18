export const metadata = {
  title: 'Simon Express — Work Ticket',
  description: 'Shop work ticket submission for Simon Express',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'SE Tickets',
    statusBarStyle: 'black-translucent',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
