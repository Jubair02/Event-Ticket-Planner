'use client'

import { useState } from 'react'
import { useAppStore, landingViewForRole } from '@/lib/store'
import { apiPost, ApiError } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, Sparkles, Ticket, UserRound, Zap } from 'lucide-react'
import type { SafeUser } from '@/lib/types'

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@ticketbd.com', password: 'admin123', icon: ShieldCheck, color: 'text-chart-4' },
  { label: 'Organizer', email: 'organizer@ticketbd.com', password: 'organizer123', icon: Sparkles, color: 'text-primary' },
  { label: 'Customer', email: 'customer@ticketbd.com', password: 'customer123', icon: UserRound, color: 'text-chart-2' },
  { label: 'Staff', email: 'staff@ticketbd.com', password: 'staff123', icon: Zap, color: 'text-chart-5' },
]

export function AuthDialog() {
  const { authOpen, authMode, setAuthOpen, setUser, navigate, consumeAuthReturnTo } = useAppStore()
  const [tab, setTab] = useState<'login' | 'register' | 'forgot'>(authMode)
  const [loading, setLoading] = useState(false)

  // login state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // register state
  const [accountType, setAccountType] = useState<'CUSTOMER' | 'ORGANIZER'>('CUSTOMER')
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regOrg, setRegOrg] = useState('')
  const [regPassword, setRegPassword] = useState('')

  // forgot state
  const [forgotStep, setForgotStep] = useState<'email' | 'reset'>('email')
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')

  function handleOpen(open: boolean) {
    setAuthOpen(open)
    if (open) setTab(authMode)
    if (!open) {
      setForgotStep('email')
      setLoading(false)
    }
  }

  function afterAuth(user: SafeUser) {
    // Read the pending target before closing, because closing clears it.
    // If auth interrupted something (e.g. tapping Buy on an event), go back
    // there instead of dropping the user on their role's landing page.
    const returnTo = consumeAuthReturnTo()
    setUser(user)
    setAuthOpen(false)
    toast.success(`Welcome, ${user.name}`)
    navigate(returnTo ?? landingViewForRole(user.role))
  }

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault()
    if (!loginEmail || !loginPassword) return toast.error('Enter email and password')
    setLoading(true)
    try {
      const data = await apiPost<{ user: SafeUser }>('/api/auth/login', {
        email: loginEmail,
        password: loginPassword,
      })
      afterAuth(data.user)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function quickLogin(email: string, password: string) {
    setLoginEmail(email)
    setLoginPassword(password)
    setLoading(true)
    try {
      const data = await apiPost<{ user: SafeUser }>('/api/auth/login', { email, password })
      afterAuth(data.user)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e?: React.FormEvent) {
    e?.preventDefault()
    if (!regName || !regEmail || !regPassword) return toast.error('Please fill in all required fields')
    if (accountType === 'ORGANIZER' && !regOrg) return toast.error('Organization name is required for organizers')
    if (regPassword.length < 6) return toast.error('Password must be at least 6 characters')
    setLoading(true)
    try {
      const data = await apiPost<{ user: SafeUser }>('/api/auth/register', {
        name: regName,
        email: regEmail,
        phone: regPhone || undefined,
        password: regPassword,
        accountType,
        organizationName: accountType === 'ORGANIZER' ? regOrg : undefined,
      })
      afterAuth(data.user)
      if (accountType === 'ORGANIZER') {
        toast.info('Your organizer account is pending admin approval.', {
          description: 'You can explore the dashboard — events go live after approval.',
        })
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e?: React.FormEvent) {
    e?.preventDefault()
    setLoading(true)
    try {
      if (forgotStep === 'email') {
        const data = await apiPost<{ ok: boolean; resetCode?: string }>('/api/auth/forgot', {
          email: forgotEmail,
        })
        setForgotStep('reset')
        if (data.resetCode) {
          // Demo mode: the server echoed the code back so it can be shown here.
          setResetCode(data.resetCode)
          toast.info('Demo mode: here is your reset code (would be emailed in production)', {
            description: `Reset code: ${data.resetCode}`,
            duration: 15000,
          })
        } else {
          // Production: the code is never sent to the browser.
          setResetCode('')
          toast.info('If an account exists for that email, a reset code has been sent.', {
            description: 'Enter the code along with your new password.',
            duration: 10000,
          })
        }
      } else {
        await apiPost('/api/auth/reset', {
          email: forgotEmail,
          code: resetCode,
          newPassword,
        })
        toast.success('Password updated! You can now log in.')
        setForgotStep('email')
        setTab('login')
        setLoginEmail(forgotEmail)
        setLoginPassword('')
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={authOpen} onOpenChange={handleOpen}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Ticket className="h-4 w-4" />
            </span>
            Welcome to TicketBD
          </DialogTitle>
          <DialogDescription>
            Book events, get QR e-tickets, or start organizing — all in one place.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'register' | 'forgot')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Sign Up</TabsTrigger>
          </TabsList>

          {/* LOGIN */}
          <TabsContent value="login" className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password">Password</Label>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setTab('forgot')}
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Login
              </Button>
            </form>

            <div className="flex items-center gap-2">
              <Separator className="flex-1" />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Demo accounts</span>
              <Separator className="flex-1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((d) => (
                <Button
                  key={d.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={loading}
                  onClick={() => quickLogin(d.email, d.password)}
                >
                  <d.icon className={`h-4 w-4 ${d.color}`} /> {d.label}
                </Button>
              ))}
            </div>
          </TabsContent>

          {/* REGISTER */}
          <TabsContent value="register" className="space-y-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
              <Button
                type="button"
                variant={accountType === 'CUSTOMER' ? 'default' : 'outline'}
                onClick={() => setAccountType('CUSTOMER')}
                className="w-full"
              >
                <UserRound className="h-4 w-4" /> Customer
              </Button>
              <Button
                type="button"
                variant={accountType === 'ORGANIZER' ? 'default' : 'outline'}
                onClick={() => setAccountType('ORGANIZER')}
                className="w-full"
              >
                <Sparkles className="h-4 w-4" /> Organizer
              </Button>
            </div>
            {accountType === 'ORGANIZER' && (
              <p className="rounded-lg bg-accent px-3 py-2 text-xs text-accent-foreground">
                🎤 Organizer accounts require admin approval before publishing events.
              </p>
            )}
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reg-name">Full name</Label>
                <Input id="reg-name" placeholder="Your name" value={regName} onChange={(e) => setRegName(e.target.value)} />
              </div>
              {accountType === 'ORGANIZER' && (
                <div className="space-y-1.5">
                  <Label htmlFor="reg-org">Organization name</Label>
                  <Input id="reg-org" placeholder="e.g. Dhaka Live Events" value={regOrg} onChange={(e) => setRegOrg(e.target.value)} />
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">Email</Label>
                  <Input id="reg-email" type="email" placeholder="you@example.com" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-phone">Phone</Label>
                  <Input id="reg-phone" placeholder="+8801XXXXXXXXX" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-password">Password</Label>
                <Input id="reg-password" type="password" placeholder="Min 6 characters" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Create {accountType === 'ORGANIZER' ? 'Organizer' : 'Customer'} Account
              </Button>
            </form>
          </TabsContent>

          {/* FORGOT */}
          <TabsContent value="forgot" className="space-y-4">
            <form onSubmit={handleForgot} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Account email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  disabled={forgotStep === 'reset'}
                />
              </div>
              {forgotStep === 'reset' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-code">Reset code</Label>
                    <Input id="reset-code" placeholder="6-digit code" value={resetCode} onChange={(e) => setResetCode(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-password">New password</Label>
                    <Input id="new-password" type="password" placeholder="Min 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  </div>
                </>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {forgotStep === 'email' ? 'Send Reset Code' : 'Reset Password'}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setTab('login')}>
                Back to login
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">
              In demo mode the reset code is shown on screen; in production it is emailed instead.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
