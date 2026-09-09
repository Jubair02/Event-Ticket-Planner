import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { AppChrome } from '@/components/app/app-chrome'
import { siteUrl } from '@/lib/routes'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const DESCRIPTION =
  "Discover events, book tickets and get QR e-tickets. Bangladesh's modern event ticketing platform — concerts, tech events, workshops, food festivals and more."

export const metadata: Metadata = {
  // Absolute base for canonical URLs, Open Graph and Twitter images. Set
  // NEXT_PUBLIC_SITE_URL in production; Vercel's domain is the fallback.
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'TicketBD — Event & Ticket Booking Platform',
    template: '%s · TicketBD',
  },
  description: DESCRIPTION,
  applicationName: 'TicketBD',
  keywords: ['events', 'tickets', 'Bangladesh', 'Dhaka', 'booking', 'QR ticket', 'concert'],
  icons: { icon: '/favicon.svg' },
  openGraph: {
    type: 'website',
    siteName: 'TicketBD',
    locale: 'en_BD',
    title: 'TicketBD — Event & Ticket Booking Platform',
    description: DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TicketBD — Event & Ticket Booking Platform',
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AppChrome>{children}</AppChrome>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  )
}
