export interface TicketImageInput {
  eventTitle: string
  when: string
  venue: string
  attendee: string
  ticketType: string
  ticketCode: string
  statusLabel: string
  /** PNG data URL of the QR, as produced by the `qrcode` package. */
  qrDataUrl: string
}

/**
 * Composes the e-ticket into a downloadable PNG.
 *
 * The "Print / Download" button used to call `window.print()`, which downloads
 * nothing on iOS — the platform most attendees are holding. This produces a
 * real file they can keep in their photo library, which also survives having
 * no signal at the gate.
 *
 * Colours are deliberately fixed (dark on white) rather than themed: a saved
 * ticket should not come out inverted because the app was in dark mode, and a
 * high-contrast QR scans far more reliably on cheap gate hardware.
 */
const W = 720
const H = 1160
const PAD = 56
const BRAND = '#0E7A57'
const INK = '#111111'
const MUTED = '#5B5B5B'
const FAINT = '#8A8A8A'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the QR image'))
    img.src = src
  })
}

/** Greedy wrap, clamped to `maxLines` with an ellipsis on the last line. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
      if (lines.length === maxLines) break
    }
  }
  if (lines.length < maxLines && current) lines.push(current)

  if (lines.length === maxLines) {
    let last = lines[maxLines - 1]
    const consumed = lines.join(' ')
    if (consumed.length < text.length) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1)
      }
      lines[maxLines - 1] = `${last.trimEnd()}…`
    }
  }
  return lines
}

function dashedRule(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save()
  ctx.strokeStyle = '#D6D6D6'
  ctx.lineWidth = 2
  ctx.setLineDash([10, 10])
  ctx.beginPath()
  ctx.moveTo(PAD, y)
  ctx.lineTo(W - PAD, y)
  ctx.stroke()
  ctx.restore()
}

export async function renderTicketImage(input: TicketImageInput): Promise<Blob> {
  const qr = await loadImage(input.qrDataUrl)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported in this browser')

  const sans = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

  // Card
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)

  // Brand band
  ctx.fillStyle = BRAND
  ctx.fillRect(0, 0, W, 104)
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `700 30px ${sans}`
  ctx.fillText('TicketBD', PAD, 64)
  ctx.textAlign = 'right'
  ctx.font = `500 20px ${sans}`
  ctx.fillText('E-TICKET', W - PAD, 62)

  // Event block
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = `700 40px ${sans}`
  const titleLines = wrapText(ctx, input.eventTitle, W - PAD * 2, 3)
  let y = 178
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y)
    y += 50
  }

  y += 4
  ctx.fillStyle = MUTED
  ctx.font = `400 24px ${sans}`
  ctx.fillText(input.when, PAD, y)
  y += 36
  const venueLines = wrapText(ctx, input.venue, W - PAD * 2, 2)
  for (const line of venueLines) {
    ctx.fillText(line, PAD, y)
    y += 32
  }

  // Perforation
  y += 16
  dashedRule(ctx, y)

  // QR plate — always white, whatever the app theme was
  const qrSize = 380
  const qrX = (W - qrSize) / 2
  const qrY = y + 40
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32)
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize)

  // Ticket code
  let ty = qrY + qrSize + 74
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = `700 42px ${mono}`
  ctx.fillText(input.ticketCode, W / 2, ty)

  // Attendee + type
  ty += 44
  ctx.fillStyle = MUTED
  ctx.font = `400 24px ${sans}`
  ctx.fillText(`${input.attendee} · ${input.ticketType}`, W / 2, ty)

  // Status
  ty += 44
  ctx.fillStyle = BRAND
  ctx.font = `600 22px ${sans}`
  ctx.fillText(input.statusLabel.toUpperCase(), W / 2, ty)

  // Footer
  ctx.fillStyle = FAINT
  ctx.font = `400 20px ${sans}`
  ctx.fillText('Present this QR code at the entrance', W / 2, H - PAD)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not produce the ticket image'))
    }, 'image/png')
  })
}
