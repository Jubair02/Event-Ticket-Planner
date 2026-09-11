'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BanknoteArrowUp, FileClock, Scale, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatDateTimeTime, formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import {
  FilterChips,
  Panel,
  SearchBox,
  SectionHeading,
  sectionProps,
  type FilterOption,
} from '@/components/dashboard/primitives'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import { ConsoleToolbar } from './console'
import { useDebounced } from './shared'

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

/**
 * Each source gets an icon as well as a tint, so the three streams stay
 * distinguishable in greyscale and under colourblindness.
 */
const SOURCE_META: Record<AuditEntry['source'], { icon: LucideIcon; tone: string; label: string }> =
  {
    REFUND: { icon: Undo2, tone: 'bg-chart-5/15 text-foreground', label: 'Refund' },
    LEDGER: { icon: Scale, tone: 'bg-primary/10 text-primary', label: 'Ledger' },
    PAYOUT: { icon: BanknoteArrowUp, tone: 'bg-chart-2/15 text-foreground', label: 'Payout' },
  }

/** `PAYMENT_CAPTURED` reads better as `Payment captured`. */
function humanise(action: string): string {
  const words = action.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function AdminAudit({ initialSource }: { initialSource: string }) {
  const [source, setSource] = useState(initialSource)
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)
  useUrlQuery(paths.adminAudit(source))

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', source],
    queryFn: () =>
      apiGet<{ entries: AuditEntry[] }>(
        `/api/admin/audit${source === 'ALL' ? '' : `?source=${source}`}`,
      ),
  })

  const entries = data?.entries ?? []

  // Filtered in the browser, not the API: the endpoint returns a bounded 60
  // rows, so a round trip per keystroke would cost more than it saves.
  const q = debounced.trim().toLowerCase()
  const visible = q
    ? entries.filter((e) =>
        [e.action, e.subject, e.detail, e.actor].join(' ').toLowerCase().includes(q),
      )
    : entries

  /**
   * Grouped by calendar day. An audit trail is read as "what happened, when",
   * and a flat 60-row list makes the reader compute that from timestamps.
   */
  const days = useMemo(() => {
    const out: { key: string; label: string; rows: AuditEntry[] }[] = []
    for (const e of visible) {
      const key = e.at.slice(0, 10)
      const last = out[out.length - 1]
      if (last && last.key === key) last.rows.push(e)
      else out.push({ key, label: formatEventDate(e.at), rows: [e] })
    }
    return out
  }, [visible])

  return (
    <div className="space-y-6">
      <section aria-labelledby="audit-heading" {...sectionProps(0)}>
        <SectionHeading
          id="audit-heading"
          title="Audit trail"
          description="Everything that moved money, newest first. Read-only by design."
        />

        <ConsoleToolbar>
          <FilterChips
            value={source}
            onChange={setSource}
            options={SOURCES}
            visible={4}
            label="Event source"
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Action, reference or actor"
            label="Search the audit trail"
          />
        </ConsoleToolbar>

        {isLoading ? (
          <Panel padded={false} className="divide-y divide-border/70">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-8 shrink-0 rounded-lg" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="hidden h-4 w-24 sm:block" />
              </div>
            ))}
          </Panel>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={FileClock}
            title={q ? 'Nothing matches that' : 'Nothing recorded yet'}
            description={
              q
                ? 'Try a different reference, action or operator name.'
                : 'Refunds, ledger postings and payout decisions all show up here as they happen.'
            }
          />
        ) : (
          <>
            <div className="space-y-4">
              {days.map((day) => (
                <section key={day.key} aria-label={day.label}>
                  {/* Sticky day marker: scrolling a long trail should never leave
                      you unsure which day you are looking at. The offset clears
                      the app's h-16 navbar. */}
                  <h3 className="sticky top-16 z-10 -mx-1 bg-background/85 px-1 py-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase backdrop-blur">
                    {day.label}
                  </h3>
                  <Panel padded={false} className="mt-1.5 divide-y divide-border/70">
                    {day.rows.map((e) => {
                      const meta = SOURCE_META[e.source]
                      return (
                        <div
                          key={e.id}
                          className="flex items-start gap-3 px-3 py-3 sm:px-4"
                        >
                          <span
                            className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-lg',
                              meta.tone,
                            )}
                            aria-hidden="true"
                          >
                            <meta.icon className="size-4" />
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm">
                              <span className="font-medium">{humanise(e.action)}</span>
                              <span className="text-muted-foreground"> · {e.subject}</span>
                            </p>
                            {e.detail && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {e.detail}
                              </p>
                            )}
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              <span className="sr-only">{meta.label} · </span>
                              {e.actor} · {formatDateTimeTime(e.at)}
                            </p>
                          </div>

                          {e.amountMinor !== null && (
                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                              {formatMinor(e.amountMinor)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </Panel>
                </section>
              ))}
            </div>

            <p className="px-1 text-xs text-muted-foreground">
              Showing the most recent <span className="tabular-nums">{entries.length}</span> events
              across refunds, the ledger and payouts.
              {q && (
                <>
                  {' '}
                  <span className="tabular-nums">{visible.length}</span> match your search.
                </>
              )}
            </p>
          </>
        )}
      </section>
    </div>
  )
}
