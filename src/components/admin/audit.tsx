'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileClock, ScrollText } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import {
  FilterChips,
  Panel,
  SectionHeading,
  entrance,
  type FilterOption,
} from '@/components/dashboard/primitives'
import { useUrlQuery } from '@/components/dashboard/use-url-query'

interface AuditEntry {
  id: string
  source: 'REFUND' | 'LEDGER' | 'PAYOUT'
  at: string
  action: string
  subject: string
  detail: string
  actor: string
  amountMinor: number | null
}

const SOURCES: FilterOption[] = [
  { value: 'ALL', label: 'Everything' },
  { value: 'REFUND', label: 'Refunds' },
  { value: 'LEDGER', label: 'Ledger' },
  { value: 'PAYOUT', label: 'Payouts' },
]

const SOURCE_TONE: Record<string, string> = {
  REFUND: 'border-chart-5/20 bg-chart-5/10 text-chart-5',
  LEDGER: 'border-primary/20 bg-primary/10 text-primary',
  PAYOUT: 'border-chart-2/20 bg-chart-2/10 text-chart-2',
}

/** `PAYMENT_CAPTURED` reads better as `Payment captured`. */
function humanise(action: string): string {
  const words = action.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function AdminAudit({ initialSource }: { initialSource: string }) {
  const [source, setSource] = useState(initialSource)
  useUrlQuery(paths.adminAudit(source))

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', source],
    queryFn: () =>
      apiGet<{ entries: AuditEntry[] }>(
        `/api/admin/audit${source === 'ALL' ? '' : `?source=${source}`}`
      ),
  })

  const entries = data?.entries ?? []

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="audit-heading"
        {...entrance(0)}
        className={cn('space-y-4', entrance(0).className)}
      >
        <SectionHeading
          id="audit-heading"
          title="Audit trail"
          description="Everything that moved money, newest first. Read-only by design."
        />

        <FilterChips value={source} onChange={setSource} options={SOURCES} label="Event source" />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={FileClock}
            title="Nothing recorded yet"
            description="Refunds, ledger postings and payout decisions all show up here as they happen."
          />
        ) : (
          <Panel padded={false} className="divide-y divide-border/70">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <Badge variant="outline" className={cn('shrink-0', SOURCE_TONE[e.source] ?? '')}>
                    {e.source}
                  </Badge>
                  <div className="min-w-0">
                    <p className="truncate">
                      <span className="font-medium">{humanise(e.action)}</span>
                      <span className="text-muted-foreground"> · {e.subject}</span>
                    </p>
                    {e.detail && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.detail}</p>
                    )}
                  </div>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  {e.amountMinor !== null && (
                    <p className="font-semibold tabular-nums">{formatMinor(e.amountMinor)}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {e.actor} · {formatEventDate(e.at)}
                  </p>
                </div>
              </div>
            ))}
          </Panel>
        )}

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ScrollText className="size-3.5" />
          Showing the most recent 60 events across all three sources.
        </p>
      </section>
    </div>
  )
}
