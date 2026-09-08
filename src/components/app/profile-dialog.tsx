'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { apiPut, ApiError } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  IdCard,
  KeyRound,
  Loader2,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Role, SafeUser } from '@/lib/types'

const DETAILS_FORM = 'profile-details-form'
const PASSWORD_FORM = 'profile-password-form'
const MIN_PASSWORD = 6

/** Icons match the ones each role carries elsewhere in the app (navbar, auth). */
const ROLE_META: Record<Role, { label: string; icon: LucideIcon }> = {
  SUPER_ADMIN: { label: 'Super Admin', icon: ShieldCheck },
  ORGANIZER: { label: 'Organizer', icon: Sparkles },
  CUSTOMER: { label: 'Customer', icon: UserRound },
  EVENT_STAFF: { label: 'Event Staff', icon: ScanLine },
}

const ORGANIZER_STATUS: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  APPROVED: { label: 'Approved', icon: BadgeCheck, tone: 'border-primary/30 text-primary' },
  PENDING: { label: 'Awaiting approval', icon: Clock3, tone: 'border-chart-5/50 text-foreground' },
  REJECTED: { label: 'Not approved', icon: TriangleAlert, tone: 'border-destructive/40 text-destructive' },
}

const STRENGTH = [
  { label: 'Too short', fill: 'bg-destructive' },
  { label: 'Weak', fill: 'bg-destructive' },
  { label: 'Fair', fill: 'bg-chart-5' },
  { label: 'Good', fill: 'bg-chart-2' },
  { label: 'Strong', fill: 'bg-primary' },
]

/** "Aisha Rahman" -> "AR"; single-word names keep their first two letters. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** ISO date -> "Aug 2024" (empty when the timestamp is unusable). */
function monthYear(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

/** 0 = unusable, 4 = strong. Length carries the most weight. */
function passwordScore(pw: string): number {
  if (pw.length < MIN_PASSWORD) return 0
  let score = 1
  if (pw.length >= 10) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

/** Deliberately permissive: the server only trims, so we catch obvious typos. */
function phoneLooksValid(value: string): boolean {
  return /^\+?[\d\s()-]{6,20}$/.test(value)
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function ProfileDialog() {
  const profileOpen = useAppStore((s) => s.profileOpen)
  const setProfileOpen = useAppStore((s) => s.setProfileOpen)
  const user = useAppStore((s) => s.user)

  if (!user) return null

  return (
    <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        {/*
          Radix unmounts dialog content on close, so keeping the form state one
          level down means every open re-seeds from the live session instead of
          resurfacing an abandoned draft.
        */}
        <ProfilePanels key={user.id} user={user} />
      </DialogContent>
    </Dialog>
  )
}

function ProfilePanels({ user }: { user: SafeUser }) {
  const setUser = useAppStore((s) => s.setUser)
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'details' | 'security'>('details')

  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [detailsTouched, setDetailsTouched] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [revealPassword, setRevealPassword] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )

  const trimmedName = name.trim()
  const trimmedPhone = phone.trim()
  const detailsDirty = trimmedName !== user.name || trimmedPhone !== (user.phone ?? '')

  const nameError = !trimmedName ? 'Enter the name that should appear on your tickets.' : ''
  const phoneError = trimmedPhone && !phoneLooksValid(trimmedPhone) ? 'Use digits, spaces, or a leading +.' : ''
  const detailsValid = !nameError && !phoneError

  const score = passwordScore(newPassword)
  const newPasswordError =
    newPassword && newPassword.length < MIN_PASSWORD
      ? `Use at least ${MIN_PASSWORD} characters.`
      : newPassword && newPassword === currentPassword
        ? 'Pick something different from your current password.'
        : ''
  const confirmError = confirmPassword && confirmPassword !== newPassword ? 'These two do not match.' : ''
  const passwordValid =
    Boolean(currentPassword) &&
    newPassword.length >= MIN_PASSWORD &&
    !newPasswordError &&
    confirmPassword === newPassword

  const role = ROLE_META[user.role] ?? { label: user.role, icon: UserRound }
  const RoleIcon = role.icon
  const joined = monthYear(user.createdAt)
  const orgStatus = user.organizer ? ORGANIZER_STATUS[user.organizer.status] : undefined

  function resetDetails() {
    setName(user.name)
    setPhone(user.phone ?? '')
    setDetailsTouched(false)
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(user.email)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Could not copy your email address')
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setDetailsTouched(true)
    if (!detailsValid || !detailsDirty) return
    setSavingProfile(true)
    try {
      const data = await apiPut<{ user: SafeUser }>('/api/auth/profile', {
        name: trimmedName,
        phone: trimmedPhone,
      })
      setUser(data.user)
      queryClient.invalidateQueries()
      setDetailsTouched(false)
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordTouched(true)
    if (!passwordValid) return
    setSavingPassword(true)
    try {
      const data = await apiPut<{ user: SafeUser }>('/api/auth/profile', { currentPassword, newPassword })
      setUser(data.user)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setRevealPassword(false)
      setPasswordTouched(false)
      toast.success('Password updated')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as 'details' | 'security')} className="gap-0">
      <header className="identity-band border-b px-6 pt-6 pb-4">
        <DialogClose
          className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label="Close profile"
        >
          <X className="size-4" />
        </DialogClose>

        <div className="flex items-start gap-4 pr-10">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-lg font-semibold tracking-tight text-primary-foreground shadow-lg shadow-primary/25"
          >
            {initialsOf(user.name)}
          </span>

          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-xl font-semibold tracking-tight">{user.name}</DialogTitle>
            <DialogDescription className="mt-1 flex min-w-0 items-center gap-1">
              <span className="truncate">{user.email}</span>
              <button
                type="button"
                onClick={copyEmail}
                aria-label={copied ? 'Email address copied' : 'Copy email address'}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
              </button>
            </DialogDescription>

            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <RoleIcon className="size-3.5" />
              {role.label}
            </span>
          </div>
        </div>

        <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {joined && (
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 text-muted-foreground" />
              <dt className="text-muted-foreground">Member since</dt>
              <dd className="font-medium tabular-nums">{joined}</dd>
            </div>
          )}
          {user.organizer && (
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="text-muted-foreground">Organization</dt>
              <dd className="truncate font-medium">{user.organizer.organizationName}</dd>
              {orgStatus && (
                <dd
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-md border bg-background/50 px-1.5 py-0.5 font-medium',
                    orgStatus.tone,
                  )}
                >
                  <orgStatus.icon className="size-3" />
                  {orgStatus.label}
                </dd>
              )}
            </div>
          )}
        </dl>

        <TabsList className="mt-5 w-full border border-border/60 bg-background/55 backdrop-blur-sm">
          <TabsTrigger value="details">
            <IdCard /> Details
            {/* Edits survive a tab switch, so flag them where they are not visible. */}
            {detailsDirty && (
              <span className="size-1.5 rounded-full bg-primary" aria-label="has unsaved changes" role="img" />
            )}
          </TabsTrigger>
          <TabsTrigger value="security">
            <KeyRound /> Security
          </TabsTrigger>
        </TabsList>
      </header>

      <div className="max-h-[52dvh] overflow-y-auto px-6 py-5">
        <TabsContent value="details" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <form id={DETAILS_FORM} onSubmit={saveProfile} className="space-y-4" noValidate>
            <p className="text-sm text-muted-foreground">
              This is the name and number printed on your tickets and used for order confirmations.
            </p>

            <Field id="profile-name" label="Full name" error={detailsTouched ? nameError : ''}>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                aria-invalid={Boolean(detailsTouched && nameError)}
                aria-describedby={detailsTouched && nameError ? 'profile-name-error' : undefined}
              />
            </Field>

            <Field
              id="profile-phone"
              label="Phone"
              hint="Optional. We text ticket confirmations to this number."
              error={detailsTouched ? phoneError : ''}
            >
              <Input
                id="profile-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+8801712345678"
                autoComplete="tel"
                className="tabular-nums"
                aria-invalid={Boolean(detailsTouched && phoneError)}
                aria-describedby={detailsTouched && phoneError ? 'profile-phone-error' : 'profile-phone-hint'}
              />
            </Field>
          </form>
        </TabsContent>

        <TabsContent value="security" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <form id={PASSWORD_FORM} onSubmit={savePassword} className="space-y-4" noValidate>
            <p className="text-sm text-muted-foreground">
              Choose a password you do not use on any other site.
            </p>

            <Field id="profile-current" label="Current password">
              <Input
                id="profile-current"
                type={revealPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your current password"
              />
            </Field>

            <Field id="profile-new" label="New password" error={passwordTouched ? newPasswordError : ''}>
              <div className="relative">
                <Input
                  id="profile-new"
                  type={revealPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                  placeholder={`At least ${MIN_PASSWORD} characters`}
                  aria-invalid={Boolean(passwordTouched && newPasswordError)}
                  aria-describedby={
                    passwordTouched && newPasswordError ? 'profile-new-error' : 'profile-new-strength'
                  }
                />
                <button
                  type="button"
                  onClick={() => setRevealPassword((v) => !v)}
                  aria-label={revealPassword ? 'Hide passwords' : 'Show passwords'}
                  className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {revealPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              <div id="profile-new-strength" className="space-y-1.5 pt-1">
                <div className="flex gap-1.5" aria-hidden="true">
                  {[1, 2, 3, 4].map((seg) => (
                    <span
                      key={seg}
                      className={cn(
                        'h-[3px] flex-1 rounded-full transition-colors duration-200',
                        newPassword && seg <= score ? STRENGTH[score].fill : 'bg-foreground/10',
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {newPassword ? (
                    <>
                      Strength: <span className="font-medium text-foreground">{STRENGTH[score].label}</span>
                    </>
                  ) : (
                    'Mix in capitals, numbers, and symbols to strengthen it.'
                  )}
                </p>
              </div>
            </Field>

            <Field
              id="profile-confirm"
              label="Confirm new password"
              error={passwordTouched || confirmPassword ? confirmError : ''}
            >
              <Input
                id="profile-confirm"
                type={revealPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Repeat the new password"
                aria-invalid={Boolean(confirmError)}
                aria-describedby={confirmError ? 'profile-confirm-error' : undefined}
              />
            </Field>
          </form>
        </TabsContent>
      </div>

      <footer className="flex flex-col-reverse gap-3 border-t bg-muted/35 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {tab === 'details' ? (
            detailsDirty ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                Unsaved changes
              </span>
            ) : (
              'Your details are up to date.'
            )
          ) : (
            'Changing your password will not sign you out.'
          )}
        </p>

        <div className="flex items-center justify-end gap-2">
          {tab === 'details' && detailsDirty && (
            <Button type="button" variant="ghost" size="sm" onClick={resetDetails}>
              Reset
            </Button>
          )}
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm" className="active:scale-[0.98]">
              Close
            </Button>
          </DialogClose>
          {tab === 'details' ? (
            <Button
              type="submit"
              form={DETAILS_FORM}
              size="sm"
              disabled={savingProfile || !detailsDirty || !detailsValid}
              className="active:scale-[0.98]"
            >
              {savingProfile && <Loader2 className="animate-spin" />}
              {savingProfile ? 'Saving' : 'Save changes'}
            </Button>
          ) : (
            <Button
              type="submit"
              form={PASSWORD_FORM}
              size="sm"
              disabled={savingPassword || !passwordValid}
              className="active:scale-[0.98]"
            >
              {savingPassword && <Loader2 className="animate-spin" />}
              {savingPassword ? 'Updating' : 'Update password'}
            </Button>
          )}
        </div>
      </footer>
    </Tabs>
  )
}
