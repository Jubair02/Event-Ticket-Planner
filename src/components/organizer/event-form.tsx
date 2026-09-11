'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { apiPost, apiPut } from '@/lib/api'
import { CATEGORIES, CATEGORY_LABELS, CITIES } from '@/lib/constants'
import { formatMinor } from '@/lib/format'
import { CategoryIcon } from '@/components/app/category-icon'
import { MAX_TICKET_PRICE_MINOR, toMinor } from '@/lib/money'
import type { EventListItem, TicketTypeDTO } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

const PRESET_BANNERS = [
  '/banners/music.png',
  '/banners/tech.png',
  '/banners/food.png',
  '/banners/business.png',
  '/banners/gaming.png',
  '/banners/cultural.png',
  '/banners/sports.png',
  '/banners/workshop.png',
]

interface TicketRow {
  name: string
  description: string
  price: string
  totalQuantity: string
  maxPerOrder: string
  salesStart: string
  salesEnd: string
}

interface FormState {
  title: string
  description: string
  category: string
  city: string
  venue: string
  address: string
  mapUrl: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
}

const emptyRow = (): TicketRow => ({
  name: '',
  description: '',
  price: '',
  totalQuantity: '',
  maxPerOrder: '5',
  salesStart: '',
  salesEnd: '',
})

const defaultForm = (): FormState => ({
  title: '',
  description: '',
  category: '',
  city: '',
  venue: '',
  address: '',
  mapUrl: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
})

/** ISO string -> "YYYY-MM-DD" in local time (for <input type="date">) */
function toDateInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dateToIso(dateStr: string, endOfDay = false): string | undefined {
  if (!dateStr) return undefined
  const d = new Date(`${dateStr}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Client-side image compression: max width 1200, JPEG q=0.75 */
async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read the selected file'))
    reader.readAsDataURL(file)
  })
  const img = new window.Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load the selected image'))
    img.src = dataUrl
  })
  const maxW = 1200
  const scale = Math.min(1, maxW / (img.width || maxW))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported in this browser')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}

function rowPayload(r: TicketRow) {
  return {
    name: r.name.trim(),
    description: r.description.trim() || undefined,
    // The field holds taka as typed; the API takes paisa. `validate` has
    // already rejected anything toMinor cannot parse, so the fallback is
    // unreachable and exists only to satisfy the type.
    priceMinor: toMinor(r.price) ?? 0,
    totalQuantity: Number(r.totalQuantity),
    maxPerOrder: Number(r.maxPerOrder || '5'),
    salesStart: dateToIso(r.salesStart),
    salesEnd: dateToIso(r.salesEnd, true),
  }
}

export function EventForm({
  editing,
  open,
  onOpenChange,
  onSaved,
}: {
  editing?: EventListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<FormState>(defaultForm())
  const [banner, setBanner] = useState<string>('')
  const [rows, setRows] = useState<TicketRow[]>([emptyRow()])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        title: editing.title,
        description: editing.description,
        category: editing.category,
        city: editing.city,
        venue: editing.venue,
        address: editing.address,
        mapUrl: editing.mapUrl ?? '',
        startDate: toDateInput(editing.startDate),
        endDate: toDateInput(editing.endDate),
        startTime: editing.startTime,
        endTime: editing.endTime,
      })
      setBanner(editing.banner ?? '')
      setRows([])
    } else {
      setForm(defaultForm())
      setBanner('')
      setRows([emptyRow()])
    }
  }, [open, editing])

  const setField = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }))
  const setRow = (idx: number, key: keyof TicketRow, value: string) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await compressImage(file)
      const res = await apiPost<{ url: string }>('/api/upload', { dataUrl })
      return res.url
    },
    onSuccess: (url) => {
      setBanner(url)
      toast.success('Banner uploaded')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function validate(): string | null {
    if (!form.title.trim()) return 'Event title is required'
    if (!form.description.trim()) return 'Description is required'
    if (!form.category) return 'Please choose a category'
    if (!form.city) return 'Please choose a city'
    if (!form.venue.trim()) return 'Venue is required'
    if (!form.address.trim()) return 'Address is required'
    if (!form.startDate || !form.endDate) return 'Start and end dates are required'
    if (new Date(`${form.endDate}T23:59:59`) < new Date(`${form.startDate}T00:00:00`))
      return 'End date cannot be before the start date'
    if (!form.startTime || !form.endTime) return 'Start and end times are required'
    if (!editing && rows.length === 0) return 'Add at least one ticket type'
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.name.trim()) return `Ticket type ${i + 1}: name is required`
      const priceMinor = toMinor(r.price)
      if (r.price === '' || priceMinor === null || priceMinor < 0) {
        return `Ticket type ${i + 1}: enter a valid price`
      }
      if (priceMinor > MAX_TICKET_PRICE_MINOR) {
        return `Ticket type ${i + 1}: price is above the maximum allowed`
      }
      const qty = Number(r.totalQuantity)
      if (!Number.isInteger(qty) || qty < 1) return `Ticket type ${i + 1}: quantity must be at least 1`
      const max = Number(r.maxPerOrder || '5')
      if (!Number.isInteger(max) || max < 1) return `Ticket type ${i + 1}: max per order must be at least 1`
    }
    return null
  }

  async function handleSave(submit: boolean) {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        city: form.city,
        venue: form.venue.trim(),
        address: form.address.trim(),
        mapUrl: form.mapUrl.trim() || undefined,
        banner: banner || undefined,
        startDate: dateToIso(form.startDate)!,
        endDate: dateToIso(form.endDate, true)!,
        startTime: form.startTime,
        endTime: form.endTime,
      }
      if (editing) {
        await apiPut<{ event: EventListItem }>(`/api/organizer/events/${editing.id}`, payload)
        for (const r of rows) {
          await apiPost(`/api/organizer/events/${editing.id}/ticket-types`, rowPayload(r))
        }
        toast.success('Event updated')
      } else {
        await apiPost('/api/organizer/events', {
          ...payload,
          submit,
          ticketTypes: rows.map(rowPayload),
        })
        toast.success(submit ? 'Event created & submitted for approval' : 'Event saved as draft')
      }
      qc.invalidateQueries({ queryKey: ['organizer-events'] })
      qc.invalidateQueries({ queryKey: ['organizer-stats'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      onOpenChange(false)
      onSaved?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || uploadMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Event' : 'Create Event'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update your event details. New ticket types are added after saving.'
              : 'Fill in the details below. You can save as a draft or submit directly for admin approval.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* ---- Basics ---- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ev-title">Title *</Label>
              <Input
                id="ev-title"
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                placeholder="e.g. Dhaka Winter Music Fest 2026"
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ev-desc">Description *</Label>
              <Textarea
                id="ev-desc"
                rows={4}
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="Tell attendees what to expect…"
              />
              <p className="text-xs text-muted-foreground">Tip: a blank line starts a new paragraph.</p>
            </div>
            <div className="grid gap-2">
              <Label>Category *</Label>
              <Select value={form.category || undefined} onValueChange={(v) => setField('category', v)}>
                <SelectTrigger aria-label="Category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {/* Lucide, not the emoji from CATEGORY_LABELS: an emoji
                          renders differently on every platform, ignores
                          currentColor so it cannot follow the theme, and is
                          announced by its unicode name rather than the label. */}
                      <CategoryIcon category={c} className="size-4 text-muted-foreground" />
                      {CATEGORY_LABELS[c]?.label ?? c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>City *</Label>
              <Select value={form.city || undefined} onValueChange={(v) => setField('city', v)}>
                <SelectTrigger aria-label="City">
                  <SelectValue placeholder="Select city" />
                </SelectTrigger>
                <SelectContent>
                  {CITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-venue">Venue *</Label>
              <Input
                id="ev-venue"
                value={form.venue}
                onChange={(e) => setField('venue', e.target.value)}
                placeholder="e.g. International Convention City Bashundhara"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-address">Address *</Label>
              <Input
                id="ev-address"
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                placeholder="Street / area address"
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ev-map">Google Maps URL (optional)</Label>
              <Input
                id="ev-map"
                value={form.mapUrl}
                onChange={(e) => setField('mapUrl', e.target.value)}
                placeholder="https://maps.google.com/…"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-start-date">Start Date *</Label>
              <Input
                id="ev-start-date"
                type="date"
                value={form.startDate}
                onChange={(e) => setField('startDate', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-end-date">End Date *</Label>
              <Input
                id="ev-end-date"
                type="date"
                value={form.endDate}
                onChange={(e) => setField('endDate', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-start-time">Start Time *</Label>
              <Input
                id="ev-start-time"
                type="time"
                value={form.startTime}
                onChange={(e) => setField('startTime', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-end-time">End Time *</Label>
              <Input
                id="ev-end-time"
                type="time"
                value={form.endTime}
                onChange={(e) => setField('endTime', e.target.value)}
              />
            </div>
          </div>

          <Separator />

          {/* ---- Banner ---- */}
          <div className="grid gap-3">
            <Label>Banner</Label>
            {banner && (
               
              <img
                src={banner}
                alt="Selected event banner preview"
                className="h-40 w-full rounded-lg border object-cover sm:h-48"
              />
            )}
            <div className="grid grid-cols-4 gap-2">
              {PRESET_BANNERS.map((p) => {
                const name = p.replace('/banners/', '').replace('.png', '')
                const active = banner === p
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setBanner(p)}
                    className={`overflow-hidden rounded-md border transition-all ${
                      active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:opacity-90'
                    }`}
                    aria-label={`Use preset ${name} banner`}
                  >
                    { }
                    <img src={p} alt={`${name} preset banner`} className="h-14 w-full object-cover" />
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploadMutation.isPending ? 'Uploading…' : 'Upload image'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadMutation.mutate(file)
                  e.target.value = ''
                }}
              />
              <div className="flex min-w-[220px] flex-1 items-center gap-2">
                <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  value={banner}
                  onChange={(e) => setBanner(e.target.value)}
                  placeholder="…or paste an image URL"
                  aria-label="Banner image URL"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* ---- Ticket types ---- */}
          <div className="grid gap-3">
            <div>
              <Label>Ticket Types</Label>
              {!editing && <p className="text-xs text-muted-foreground">At least one ticket type is required.</p>}
              {editing && (
                <p className="text-xs text-muted-foreground">
                  Existing types are listed read-only — manage or remove them from the event&apos;s Analytics dialog.
                </p>
              )}
            </div>

            {editing && (editing.ticketTypes?.length ?? 0) > 0 && (
              <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Existing ticket types</p>
                {editing.ticketTypes.map((t: TicketTypeDTO) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted-foreground">
                      {formatMinor(t.priceMinor)} · {t.soldQuantity}/{t.totalQuantity} sold
                    </span>
                  </div>
                ))}
              </div>
            )}

            {rows.map((r, idx) => (
              <div key={idx} className="grid gap-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{editing ? 'New ticket type' : `Ticket type ${idx + 1}`}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                    aria-label={`Remove ticket type ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`tt-name-${idx}`}>Name *</Label>
                    <Input
                      id={`tt-name-${idx}`}
                      value={r.name}
                      onChange={(e) => setRow(idx, 'name', e.target.value)}
                      placeholder="e.g. Regular / VIP"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`tt-price-${idx}`}>Price (৳) *</Label>
                    <Input
                      id={`tt-price-${idx}`}
                      type="number"
                      min="0"
                      value={r.price}
                      onChange={(e) => setRow(idx, 'price', e.target.value)}
                      placeholder="500"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`tt-qty-${idx}`}>Total Quantity *</Label>
                    <Input
                      id={`tt-qty-${idx}`}
                      type="number"
                      min="1"
                      value={r.totalQuantity}
                      onChange={(e) => setRow(idx, 'totalQuantity', e.target.value)}
                      placeholder="100"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`tt-max-${idx}`}>Max Per Order</Label>
                    <Input
                      id={`tt-max-${idx}`}
                      type="number"
                      min="1"
                      value={r.maxPerOrder}
                      onChange={(e) => setRow(idx, 'maxPerOrder', e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`tt-ss-${idx}`}>Sales Start (optional)</Label>
                    <Input
                      id={`tt-ss-${idx}`}
                      type="date"
                      value={r.salesStart}
                      onChange={(e) => setRow(idx, 'salesStart', e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`tt-se-${idx}`}>Sales End (optional)</Label>
                    <Input
                      id={`tt-se-${idx}`}
                      type="date"
                      value={r.salesEnd}
                      onChange={(e) => setRow(idx, 'salesEnd', e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor={`tt-desc-${idx}`}>Description (optional)</Label>
                    <Input
                      id={`tt-desc-${idx}`}
                      value={r.description}
                      onChange={(e) => setRow(idx, 'description', e.target.value)}
                      placeholder="What's included…"
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setRows((rs) => [...rs, emptyRow()])}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Ticket Type
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {editing ? (
            <Button onClick={() => handleSave(false)} disabled={busy}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleSave(false)} disabled={busy}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save as Draft
              </Button>
              <Button onClick={() => handleSave(true)} disabled={busy}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit for Approval
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
