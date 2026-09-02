'use client'

import { useAppStore } from '@/lib/store'
import { apiPost } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Ticket, CalendarDays, LayoutDashboard, ShieldCheck, ScanLine, LogOut, UserCircle, Moon, Sun, Sparkles } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORGANIZER: 'Organizer',
  CUSTOMER: 'Customer',
  EVENT_STAFF: 'Event Staff',
}

export function Navbar() {
  const { user, view, navigate, openAuth, setUser } = useAppStore()
  const { theme, setTheme } = useTheme()

  const active = view.name

  async function handleLogout() {
    try {
      await apiPost('/api/auth/logout')
      setUser(null)
      navigate({ name: 'home' })
      toast.success('Logged out. See you soon!')
    } catch {
      toast.error('Failed to log out')
    }
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        {/* Logo */}
        <button
          onClick={() => navigate({ name: 'home' })}
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
          aria-label="TicketBD home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Ticket className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            Ticket<span className="text-primary">BD</span>
          </span>
        </button>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          <Button
            variant={active === 'home' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => navigate({ name: 'home' })}
          >
            <CalendarDays className="h-4 w-4" /> Browse Events
          </Button>
          {user?.role === 'CUSTOMER' && (
            <Button
              variant={active === 'my-tickets' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => navigate({ name: 'my-tickets' })}
            >
              <Ticket className="h-4 w-4" /> My Tickets
            </Button>
          )}
          {user?.role === 'ORGANIZER' && (
            <Button
              variant={active === 'organizer' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => navigate({ name: 'organizer', tab: 'overview' })}
            >
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Button>
          )}
          {user?.role === 'SUPER_ADMIN' && (
            <Button
              variant={active === 'admin' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => navigate({ name: 'admin', tab: 'overview' })}
            >
              <ShieldCheck className="h-4 w-4" /> Admin
            </Button>
          )}
          {user?.role === 'EVENT_STAFF' && (
            <Button
              variant={active === 'staff' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => navigate({ name: 'staff' })}
            >
              <ScanLine className="h-4 w-4" /> Scanner
            </Button>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Sun className="h-4 w-4 dark:hidden" />
            <Moon className="hidden h-4 w-4 dark:block" />
          </Button>

          {!user ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => openAuth('login')}>
                Login
              </Button>
              <Button size="sm" onClick={() => openAuth('register')}>
                <Sparkles className="h-4 w-4" /> Sign Up
              </Button>
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
                  <Avatar className="h-9 w-9 border">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {user.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-semibold">{user.name}</span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                    <Badge variant="secondary" className="mt-1 w-fit text-[10px]">
                      {ROLE_LABELS[user.role]}
                    </Badge>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ name: 'profile' })}>
                  <UserCircle className="h-4 w-4" /> Profile
                </DropdownMenuItem>
                {user.role === 'CUSTOMER' && (
                  <DropdownMenuItem onClick={() => navigate({ name: 'my-tickets' })}>
                    <Ticket className="h-4 w-4" /> My Tickets
                  </DropdownMenuItem>
                )}
                {user.role === 'ORGANIZER' && (
                  <DropdownMenuItem onClick={() => navigate({ name: 'organizer', tab: 'overview' })}>
                    <LayoutDashboard className="h-4 w-4" /> Organizer Dashboard
                  </DropdownMenuItem>
                )}
                {user.role === 'SUPER_ADMIN' && (
                  <DropdownMenuItem onClick={() => navigate({ name: 'admin', tab: 'overview' })}>
                    <ShieldCheck className="h-4 w-4" /> Admin Dashboard
                  </DropdownMenuItem>
                )}
                {user.role === 'EVENT_STAFF' && (
                  <DropdownMenuItem onClick={() => navigate({ name: 'staff' })}>
                    <ScanLine className="h-4 w-4" /> QR Scanner
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      {user && (
        <nav className="flex gap-1 overflow-x-auto border-t px-4 py-2 md:hidden" aria-label="Mobile navigation">
          <Button variant={active === 'home' ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate({ name: 'home' })}>
            Events
          </Button>
          {user.role === 'CUSTOMER' && (
            <Button variant={active === 'my-tickets' ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate({ name: 'my-tickets' })}>
              My Tickets
            </Button>
          )}
          {user.role === 'ORGANIZER' && (
            <Button variant={active === 'organizer' ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate({ name: 'organizer', tab: 'overview' })}>
              Dashboard
            </Button>
          )}
          {user.role === 'SUPER_ADMIN' && (
            <Button variant={active === 'admin' ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate({ name: 'admin', tab: 'overview' })}>
              Admin
            </Button>
          )}
          {user.role === 'EVENT_STAFF' && (
            <Button variant={active === 'staff' ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate({ name: 'staff' })}>
              Scanner
            </Button>
          )}
        </nav>
      )}
    </header>
  )
}
