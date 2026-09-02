'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { apiPut, ApiError } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { SafeUser } from '@/lib/types'

const ROLE_BADGE: Record<string, { label: string; variant?: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  SUPER_ADMIN: { label: '👑 Super Admin' },
  ORGANIZER: { label: '🎤 Organizer' },
  CUSTOMER: { label: '👤 Customer', variant: 'secondary' },
  EVENT_STAFF: { label: '🛂 Event Staff', variant: 'outline' },
}

export function ProfileDialog() {
  const { view, navigate, user, setUser } = useAppStore()
  const queryClient = useQueryClient()
  const open = view.name === 'profile'

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (user && open) {
      setName(user.name)
      setPhone(user.phone ?? '')
    }
  }, [user, open])

  if (!user) return null

  async function saveProfile() {
    setSavingProfile(true)
    try {
      const data = await apiPut<{ user: SafeUser }>('/api/auth/profile', { name, phone })
      setUser(data.user)
      queryClient.invalidateQueries()
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword() {
    setSavingPassword(true)
    try {
      const data = await apiPut<{ user: SafeUser }>('/api/auth/profile', { currentPassword, newPassword })
      setUser(data.user)
      setCurrentPassword('')
      setNewPassword('')
      toast.success('Password updated')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  const badge = ROLE_BADGE[user.role] ?? { label: user.role }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && navigate({ name: 'home' })}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            My Profile <Badge variant={badge.variant ?? 'default'}>{badge.label}</Badge>
          </DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Basic info</h4>
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Full name</Label>
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input id="profile-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8801XXXXXXXXX" />
            </div>
            <Button onClick={saveProfile} disabled={savingProfile} className="w-full sm:w-auto">
              {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </Button>
          </div>

          <Separator />

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Change password</h4>
            <div className="space-y-1.5">
              <Label htmlFor="profile-current">Current password</Label>
              <Input
                id="profile-current"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-new">New password</Label>
              <Input
                id="profile-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 6 characters"
              />
            </div>
            <Button onClick={savePassword} disabled={savingPassword || !currentPassword || !newPassword} className="w-full sm:w-auto">
              {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />} Update password
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
