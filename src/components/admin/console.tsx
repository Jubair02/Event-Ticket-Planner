'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Panel, panelClass } from '@/components/dashboard/primitives'

/**
 * The admin console kit.
 *
 * All six queue pages — organizers, events, users, payments, refunds, payouts —
 * are the same shape: a filtered list of records with a status, some money or a
 * count, and one or two actions. They were each built separately and each
 * invented their own row treatment, so the console read as six products.
 * These pieces are that shape, once.
 *
 * ## The responsive table
 *
 * A dense admin table cannot simply scroll sideways on a phone: "avoid
 * horizontal scrolling" is a high-severity rule, and an operator triaging a
 * refund queue on mobile should not have to drag the viewport to find the
 * button. Nor can it become a separate card list, because rendering the rows
 * twice and hiding one exposes both copies to a screen reader.
 *
 * So there is **one** semantic `<table>` whose display switches at `md`:
 * `<tbody>`, `<tr>` and `<td>` are `block` below the breakpoint and revert to
 * their table roles above it. One DOM, real table semantics for assistive tech
 * and keyboard order, and rows that become self-contained cards on a phone —
 * where each cell shows the column label the hidden `<thead>` would have given
 * it.
 */

// ---------------------------------------------------------------- table

export interface ConsoleColumn {
  /** Column heading. Also the per-cell label on mobile. */
  label: string
  /** Hide the heading visually — for an actions column with no meaningful name. */
  srOnly?: boolean
  className?: string
}

export function ConsoleTable({
  columns,
  caption,
  children,
}: {
  columns: ConsoleColumn[]
  /** Describes the table for assistive tech; never shown. */
  caption: string
  children: React.ReactNode
}) {
  return (
    <Panel padded={false} className="overflow-hidden">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        {/* Hidden on mobile, where each cell carries its own label instead. */}
        <thead className="hidden md:table-header-group">
          <tr className="border-b bg-muted/40 text-left">
            {columns.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase',
                  c.className,
                )}
              >
                {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block divide-y divide-border/70 md:table-row-group">{children}</tbody>
      </table>
    </Panel>
  )
}

/**
 * `tone` paints a 2px left edge — a second, non-colour channel is always the
 * badge inside the row, so this is reinforcement rather than the only signal.
 */
export function ConsoleRow({
  tone,
  children,
}: {
  tone?: 'attention' | 'danger'
  children: React.ReactNode
}) {
  return (
    <tr
      className={cn(
        'relative block px-1 py-3 transition-colors md:table-row md:px-0 md:py-0',
        'hover:bg-muted/40',
        tone === 'attention' && 'border-l-2 border-l-chart-5 md:border-l-2',
        tone === 'danger' && 'border-l-2 border-l-destructive md:border-l-2',
      )}
    >
      {children}
    </tr>
  )
}

export function ConsoleCell({
  label,
  align = 'left',
  className,
  children,
}: {
  /** The column this cell belongs to; shown beside the value on mobile only. */
  label: string
  align?: 'left' | 'right' | 'center'
  className?: string
  children: React.ReactNode
}) {
  return (
    <td
      className={cn(
        'flex items-baseline justify-between gap-4 px-3 py-1 md:table-cell md:px-4 md:py-3',
        align === 'right' && 'md:text-right',
        align === 'center' && 'md:text-center',
        className,
      )}
    >
      <span
        className="shrink-0 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase md:hidden"
        aria-hidden="true"
      >
        {label}
      </span>
      <span className={cn('min-w-0 md:block', align === 'right' && 'text-right')}>{children}</span>
    </td>
  )
}

/** Right-aligned on desktop, full-width under it so buttons stay thumb-sized. */
export function ConsoleActions({ children }: { children: React.ReactNode }) {
  return (
    <td className="block px-3 pt-2.5 md:table-cell md:px-4 md:py-3">
      <div className="flex flex-wrap gap-1.5 md:justify-end">{children}</div>
    </td>
  )
}

// ---------------------------------------------------------------- headline

/**
 * The dense counterpart to `HeroMetric`.
 *
 * Queue pages run at density 8/10, where a 48px hero figure and a six-row
 * metric list cost most of the first screen before a single record appears.
 * This says the same things in one band: the number that matters, then the
 * supporting figures inline.
 */
export function StatStrip({
  items,
  loading,
  className,
  style,
}: {
  items: { label: string; value: string | number; tone?: 'default' | 'attention' | 'danger' }[]
  loading?: boolean
  className?: string
  /** Accepts the `style` half of `sectionProps`, which carries the stagger. */
  style?: React.CSSProperties
}) {
  return (
    <dl
      style={style}
      className={cn(
        panelClass,
        'grid grid-cols-2 divide-border/70 sm:grid-cols-4 sm:divide-x',
        className,
      )}
    >
      {items.map((it) => (
        <div key={it.label} className="px-4 py-3.5">
          <dt className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {it.label}
          </dt>
          {loading ? (
            <Skeleton className="mt-1.5 h-6 w-16" />
          ) : (
            <dd
              className={cn(
                'mt-1 text-xl font-semibold tracking-tight',
                it.tone === 'attention' && 'text-chart-5',
                it.tone === 'danger' && 'text-destructive',
              )}
            >
              {it.value}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

/**
 * Filters and search on one visible line.
 *
 * The design DB's anti-pattern for this product type is **"Hidden filters"** —
 * an operator should never have to open a menu to discover how a queue can be
 * narrowed. Everything lives in the flow of the page, above the table.
 */
export function ConsoleToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      {children}
    </div>
  )
}

/** Row skeleton sized to the real thing, so the table does not jump on load. */
export function ConsoleSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <Panel padded={false} className="divide-y divide-border/70 overflow-hidden">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="size-9 shrink-0 rounded-xl" />
          <Skeleton className="h-4 flex-1" />
          {Array.from({ length: Math.max(cols - 2, 0) }).map((__, c) => (
            <Skeleton key={c} className="hidden h-4 w-20 md:block" />
          ))}
        </div>
      ))}
    </Panel>
  )
}

/**
 * Confirmation for a single destructive row action.
 *
 * `ConfirmDialog` in `shared.tsx` is shaped around a bulk selection (it takes a
 * `count`), so the money queues had nothing to reach for and fired `reject`
 * straight off one click. Rejecting a refund or a payout is not undoable from
 * the UI, so it gets the same guard the bulk paths already had.
 */
export function ActionConfirm({
  open,
  title,
  body,
  cta,
  pending,
  destructive = true,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body: string
  cta: string
  pending?: boolean
  /** Reversing a suspension is not destructive, so it does not get the red button. */
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={(ev) => {
              ev.preventDefault()
              onConfirm()
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            {cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Shown when a query is capped, so a missing record is never a mystery. */
export function TruncatedNote({ shown, noun }: { shown: number; noun: string }) {
  return (
    <p className="px-1 text-xs text-muted-foreground">
      Showing the most recent <span className="tabular-nums">{shown}</span> {noun}. Narrow the
      filters or search to reach older ones.
    </p>
  )
}

/**
 * The identity block a queue row leads with: an icon plate, a title that links
 * to the record, and one line of supporting detail.
 */
export function RowIdentity({
  icon,
  title,
  href,
  meta,
  tone = 'default',
}: {
  icon: React.ReactNode
  title: React.ReactNode
  href?: string
  meta?: React.ReactNode
  tone?: 'default' | 'muted'
}) {
  return (
    <span className="flex items-start gap-3">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          tone === 'muted' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {href ? (
            <a
              href={href}
              className="rounded-sm transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </span>
        {meta && <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>}
      </span>
    </span>
  )
}
