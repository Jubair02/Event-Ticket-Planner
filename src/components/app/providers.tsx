'use client'

import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useAppStore } from '@/lib/store'
import { apiGet } from '@/lib/api'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
}

/** Loads the current session into the store once on app mount */
export function useSessionLoader() {
  const setUser = useAppStore((s) => s.setUser)
  const setAuthLoaded = useAppStore((s) => s.setAuthLoaded)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiGet<{ user: unknown }>('/api/auth/me')
        if (!cancelled) setUser((data.user as never) ?? null)
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setAuthLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setUser, setAuthLoaded])
}
