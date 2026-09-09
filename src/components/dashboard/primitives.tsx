'use client'

import type { CSSProperties } from 'react'
import { Search } from 'lucide-react'
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

/** The one number worth reading at a glance — given the size to match. */
export function HeroMetric({
  label,
  value,
  hint,
  loading,
  icon: Icon,
  children,
  className,
}: {
  label: string
  value: string | number
  hint?: string
  loading?: boolean
  icon?: LucideIcon
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
        <Skeleton className="relative mt-3 h-10 w-44" />
      ) : (
        <p className="relative mt-3 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{value}</p>
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
