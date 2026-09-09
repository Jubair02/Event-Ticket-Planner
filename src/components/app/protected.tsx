'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import type { Role } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/empty-state'

/**
 * Client-side gate for the signed-in routes.
 *
 * This is presentation only — every API route re-checks the session and role
 * server-side, so hiding a page here is convenience, never the security
 * boundary. It replaces the auth gate and the wrong-role redirect that used to
 * live in the single-page shell.
 */
export function Protected({
  roles,
  children,
}: {
  /** Allowed roles. Omit to require only that someone is signed in. */
  roles?: Role[]
  children: React.ReactNode
}) {
  const router = useRouter()
  const user = useAppStore((s) => s.user)
  const authLoaded = useAppStore((s) => s.authLoaded)
  const openAuth = useAppStore((s) => s.openAuth)

  const wrongRole = !!user && !!roles && !roles.includes(user.role)

  useEffect(() => {
    if (wrongRole) router.replace('/')
  }, [wrongRole, router])

  if (!authLoaded) {
    return (
      <div className="flex items-center justify-center py-32 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={Lock}
          title="Please sign in"
          description="You need an account to open this page."
          action={<Button onClick={() => openAuth('login')}>Sign in</Button>}
        />
      </div>
    )
  }

  if (wrongRole) {
    return (
      <div className="flex items-center justify-center py-32 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Redirecting…
      </div>
    )
  }

  return <>{children}</>
}
