'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

/*
 * Pieces the admin sections share. These were private helpers inside the
 * single admin-dashboard component; they moved here when each tab became its
 * own route and its own file.
 */

// Debouncing moved to `@/hooks/use-debounced` when the public search box
// needed it too. Re-exported so the admin sections keep one import.
export { useDebounced } from '@/hooks/use-debounced'

/**
 * Run `fn` over every item with a concurrency cap, collecting per-item outcomes.
 * There is no bulk endpoint, so bulk actions fan out over the single-row API;
 * the cap keeps a 200-row selection from opening 200 sockets at once.
 */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  const results: PromiseSettledResult<unknown>[] = []
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.allSettled(items.slice(i, i + limit).map(fn))))
  }
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  return { total: results.length, done: results.length - failures.length, failures }
}

/** Reports a bulk outcome as one toast rather than one per row. */
export function reportBulk(noun: string, verb: string, r: Awaited<ReturnType<typeof mapLimit>>) {
  if (r.failures.length === 0) {
    toast.success(`${r.done} ${noun}${r.done === 1 ? '' : 's'} ${verb}`)
    return
  }
  const reason = r.failures[0].reason
  const detail = reason instanceof Error ? reason.message : 'Some changes were rejected'
  toast.error(`${r.done} of ${r.total} ${noun}s ${verb}`, { description: detail })
}

export function useSelection() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set())
  return {
    ids,
    clear: () => setIds(new Set()),
    toggle: (id: string) =>
      setIds((prev) => {
        const next = new Set(prev)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    setMany: (rowIds: string[], on: boolean) =>
      setIds((prev) => {
        const next = new Set(prev)
        for (const id of rowIds) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
  }
}

// ============================= Shared presentation =============================





export type BulkAction = {
  key: string
  label: string
  icon: LucideIcon
  count: number
  destructive?: boolean
  confirm?: { title: string; body: string; cta: string }
}

/**
 * Selection action bar. Each action carries the number of selected rows it can
 * actually apply to, so the admin never fires a request the API will reject.
 */
export function BulkBar({
  selectedCount,
  actions,
  running,
  onRun,
  onClear,
}: {
  selectedCount: number
  actions: BulkAction[]
  running: string | null
  onRun: (action: BulkAction) => void
  onClear: () => void
}) {
  if (selectedCount === 0) return null
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2"
    >
      <span className="text-sm font-medium tabular-nums">{selectedCount} selected</span>
      <span className="mr-auto h-4 w-px bg-border" aria-hidden="true" />
      {actions.map((a) => (
        <Button
          key={a.key}
          size="sm"
          variant={a.destructive ? 'destructive' : 'default'}
          className="h-8 active:scale-[0.98]"
          disabled={a.count === 0 || running !== null}
          onClick={() => onRun(a)}
          title={a.count === 0 ? 'No selected rows are eligible for this action' : undefined}
        >
          {running === a.key ? <Loader2 className="animate-spin" /> : <a.icon />}
          {a.label}
          <span className="tabular-nums opacity-70">({a.count})</span>
        </Button>
      ))}
      <Button size="sm" variant="ghost" className="h-8" onClick={onClear} disabled={running !== null}>
        Clear
      </Button>
    </div>
  )
}

export function ConfirmDialog({
  action,
  onCancel,
  onConfirm,
  running,
}: {
  action: BulkAction | null
  onCancel: () => void
  onConfirm: () => void
  running: boolean
}) {
  return (
    <AlertDialog open={action !== null} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action?.confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{action?.confirm?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={action?.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={(ev) => {
              ev.preventDefault()
              onConfirm()
            }}
          >
            {running && <Loader2 className="animate-spin" />}
            {action?.confirm?.cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
