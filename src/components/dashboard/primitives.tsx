'use client'

import type { CSSProperties } from 'react'
import { Minus, Search, TrendingDown, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/*
 * Shared building blocks for the organizer and admin dashboards. Several of
 * these started life as private helpers inside admin-dashboard.tsx; they moved
 * here so both dashboards render from one visual system.
 */

// ---------------------------------------------------------------- surfaces

/** The standard dashboard surface. Softer radius than inner elements, tinted shadow. */
export const panelClass = 'rounded-2xl border border-border/70 bg-card shadow-sm shadow-primary/[0.04]'

export function Panel({
  className,
  padded = true,
  ...props
}: React.ComponentProps<'div'> & { padded?: boolean }) {
  return <div className={cn(panelClass, padded && 'p-5 sm:p-6', className)} {...props} />
}

/** Entry animation for top-level dashboard blocks; index staggers the delay. */
export function entrance(index = 0): { className: string; style: CSSProperties } {
  return {
    className:
      'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards motion-reduce:animate-none',
    style: { animationDelay: `${Math.min(index, 8) * 60}ms` },
  }
}

/**
 * Props for a dashboard section: its own classes merged with the entrance
 * animation.
 *
 * Every section previously had to write
 * `{...entrance(2)} className={cn('space-y-4', entrance(2).className)}` —
 * calling `entrance` twice and relying on prop order, which three pages got
 * wrong by spreading after `className` and silently losing their own classes.
 */
export function sectionProps(index: number, className = 'space-y-4') {
  const e = entrance(index)
  return { className: cn(className, e.className), style: e.style }
}

// ---------------------------------------------------------------- headings

export function SectionHeading({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

/** Small-caps label used above metric groups and panel sections. */
export function Eyebrow({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn('text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase', className)}
      {...props}
    />
  )
}

// ---------------------------------------------------------------- metrics

/**
 * Signed change against a named baseline.
 *
 * Colour alone never carries the direction — the arrow does too, so the chip
 * survives colourblindness and greyscale print. `goodWhenUp` exists because
 * "up" is not always good: more refunds is a worse number, not a better one.
 */
export function DeltaChip({
  ratio,
  since,
  goodWhenUp = true,
  className,
}: {
  /** Signed fraction, e.g. 0.12 for +12%. */
  ratio: number
  /** What it is measured against, e.g. "vs previous event". */
  since: string
  goodWhenUp?: boolean
  className?: string
}) {
  const up = ratio >= 0
  const good = up === goodWhenUp
  const Arrow = up ? TrendingUp : TrendingDown
  // Rounded first, so a +0.4% change reads as "no change" rather than "+0%",
  // which looks like a bug.
  const pct = Math.round(Math.abs(ratio) * 100)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        pct === 0
          ? 'bg-muted text-muted-foreground'
          : good
            ? 'bg-primary/10 text-primary'
            : 'bg-destructive/10 text-destructive',
        className,
      )}
    >
      {pct === 0 ? (
        <Minus className="size-3" aria-hidden="true" />
      ) : (
        <Arrow className="size-3" aria-hidden="true" />
      )}
      {pct === 0 ? 'No change' : `${up ? '+' : '−'}${pct}%`}
      <span className="font-normal opacity-75">{since}</span>
    </span>
  )
}

/**
 * A single ratio against a limit.
 *
 * The unfilled track is a lighter step of the fill's own ramp rather than a
 * neutral grey, so the bar reads as one scale end to end instead of "coloured
 * part plus empty part". Severity rides the fill: primary until the value is
 * high enough to matter, then the amber `chart-5` at the same 80% threshold
 * `event-card` and `event-detail` already use for "almost gone".
 */
export function Meter({
  value,
  max,
  label,
  hot = 0.8,
  className,
}: {
  value: number
  max: number
  /** Sentence describing the ratio, for assistive tech. */
  label: string
  /** Fraction at which the fill switches to the warning tone. */
  hot?: number
  className?: string
}) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <div
      className={cn('h-1.5 overflow-hidden rounded-full bg-primary/12', className)}
      role="img"
      aria-label={label}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
          ratio >= hot ? 'bg-chart-5' : 'bg-primary',
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}

/** The one number worth reading at a glance — given the size to match. */
export function HeroMetric({
  label,
  value,
  hint,
  loading,
  icon: Icon,
  delta,
  children,
  className,
}: {
  label: string
  value: string | number
  hint?: string
  loading?: boolean
  icon?: LucideIcon
  /** Rendered beside the value — a `DeltaChip`, or nothing when there is no honest baseline. */
  delta?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <Panel className={cn('relative overflow-hidden', className)}>
      <div
        className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative flex items-start justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="relative mt-3 h-11 w-44" />
      ) : (
        <div className="relative mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          {/* Proportional figures, not `tabular-nums`: equal-width digits are for
              columns that must align, and at display size they make a number
              like 121 look loosely spaced. */}
          <p className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{value}</p>
          {delta}
        </div>
      )}
      {hint && <p className="relative mt-1.5 text-xs text-muted-foreground tabular-nums">{hint}</p>}
      {children}
    </Panel>
  )
}

/** Quiet metric list. Deliberately not a card grid: these are reference numbers. */
export function MetricGroup({
  title,
  items,
  loading,
  className,
}: {
  title: string
  items: { label: string; value: string | number }[]
  loading: boolean
  className?: string
}) {
  return (
    <Panel className={cn('p-5', className)} padded={false}>
      <Eyebrow>{title}</Eyebrow>
      <dl className="mt-3 divide-y divide-border/70">
        {items.map((it) => (
          <div key={it.label} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
            <dt className="text-sm text-muted-foreground">{it.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {loading ? <Skeleton className="h-4 w-12" /> : it.value}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

// ---------------------------------------------------------------- filters

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      className={cn(
        'h-8 rounded-full px-3 text-xs transition-transform active:scale-[0.97] motion-reduce:transform-none',
        !active && 'text-muted-foreground',
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </Button>
  )
}

export interface FilterOption {
  value: string
  label: string
  count?: number
  /**
   * Optional swatch drawn before the label. It ties a chip to the chart
   * segment of the same colour, so a distribution chart above the row never
   * carries its meaning by colour alone — the chips are its legend.
   */
  dotClass?: string
}

/**
 * A chip row that stays short. The first `visible` options render as chips;
 * the rest fold into a "More" select. Whatever is active is always shown as a
 * chip, so the current filter is never hidden inside the menu.
 */
export function FilterChips({
  value,
  onChange,
  options,
  visible = 4,
  label = 'Filter',
}: {
  value: string
  onChange: (v: string) => void
  options: FilterOption[]
  visible?: number
  label?: string
}) {
  const primary = options.slice(0, visible)
  const overflow = options.slice(visible)
  const activeInOverflow = overflow.find((o) => o.value === value)

  const chip = (o: FilterOption) => (
    <FilterChip key={o.value} active={value === o.value} onClick={() => onChange(o.value)}>
      {o.dotClass && (
        <span
          // The active chip is filled with `primary`, which would swallow a
          // `bg-primary` swatch whole. `bg-current` keeps the dot visible there
          // without changing the chip's width as it is selected.
          className={cn('size-1.5 shrink-0 rounded-full', value === o.value ? 'bg-current opacity-60' : o.dotClass)}
          aria-hidden="true"
        />
      )}
      {o.label}
      {typeof o.count === 'number' && (
        <span className={cn('tabular-nums', value === o.value ? 'opacity-80' : 'opacity-70')}>{o.count}</span>
      )}
    </FilterChip>
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {primary.map(chip)}
      {activeInOverflow && chip(activeInOverflow)}
      {overflow.length > 0 && (
        <Select value={activeInOverflow ? value : ''} onValueChange={onChange}>
          <SelectTrigger
            className="h-8 w-auto gap-1 rounded-full px-3 text-xs text-muted-foreground"
            aria-label={`More ${label.toLowerCase()} options`}
          >
            <SelectValue placeholder="More" />
          </SelectTrigger>
          <SelectContent align="start">
            {overflow.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.dotClass && (
                  <span className={cn('size-1.5 shrink-0 rounded-full', o.dotClass)} aria-hidden="true" />
                )}
                {o.label}
                {typeof o.count === 'number' && (
                  <span className="ml-1.5 text-muted-foreground tabular-nums">{o.count}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label={label}
      />
    </div>
  )
}
