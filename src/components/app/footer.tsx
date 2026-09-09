'use client'

import { Ticket, MapPin, ShieldCheck, Mail } from 'lucide-react'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import { Button } from '@/components/ui/button'

export function Footer() {
  const openAuth = useAppStore((s) => s.openAuth)

  return (
    <footer className="mt-auto border-t bg-foreground text-background dark:bg-card">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Ticket className="h-5 w-5" />
              </span>
              <span className="text-lg font-bold tracking-tight">
                Ticket<span className="text-primary">BD</span>
              </span>
            </div>
            <p className="mt-3 max-w-md text-sm opacity-70">
              Bangladesh&apos;s modern event ticketing platform. Discover events, book tickets with SSLCOMMERZ
              secure payment, and get instant QR e-tickets — from Dhaka to Cox&apos;s Bazar. 🇧🇩
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              {['SSLCOMMERZ', 'bKash', 'Nagad', 'Visa', 'Mastercard'].map((p) => (
                <span key={p} className="rounded-md border border-background/20 bg-background/10 px-2 py-1 font-medium">
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Explore</h3>
            <ul className="mt-3 space-y-2 text-sm opacity-70">
              <li>
                <Link className="hover:opacity-100 hover:underline" href={paths.events()}>
                  Browse Events
                </Link>
              </li>
              <li>
                <Link className="hover:underline" href={paths.home()}>
                  Popular Events
                </Link>
              </li>
              <li>
                <button className="hover:underline" onClick={() => openAuth('register')}>
                  Become an Organizer
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Trust & Safety</h3>
            <ul className="mt-3 space-y-2 text-sm opacity-70">
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Verified e-tickets with QR
              </li>
              <li className="flex items-center gap-2">
                <Ticket className="h-4 w-4" /> Anti-duplicate check-in
              </li>
              <li className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Events in 6 cities
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4" /> support@ticketbd.com
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-background/15 pt-6 text-xs opacity-60 sm:flex-row">
          <span>© {new Date().getFullYear()} TicketBD. All rights reserved.</span>
          <span>Made for Bangladesh 🇧🇩 · Dhaka · Chattogram · Sylhet · Khulna · Rajshahi · Cox&apos;s Bazar</span>
        </div>
      </div>
    </footer>
  )
}
