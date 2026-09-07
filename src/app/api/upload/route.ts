import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { AuthError, requireRole } from '@/lib/auth'

// Writing to public/ needs the Node runtime (not edge).
export const runtime = 'nodejs'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_BYTES = Math.floor(1.5 * 1024 * 1024)
// base64 inflates by ~4/3; reject obviously oversized payloads before decoding.
const MAX_DATAURL_CHARS = Math.ceil(MAX_BYTES * 1.4) + 1024

/**
 * POST /api/upload — body `{ dataUrl }` (client-side compressed image data URL).
 * Writes the decoded image to public/uploads and returns its public path.
 *
 * Organizer/admin only: an unauthenticated endpoint that writes files to disk
 * would let anyone fill the volume.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole('ORGANIZER', 'SUPER_ADMIN')

    // Serverless hosts (Vercel) have a read-only filesystem and do not serve
    // files written at runtime, so fail with something the organizer can act on
    // instead of an opaque write error.
    if (process.env.VERCEL) {
      return NextResponse.json(
        {
          error:
            'Image upload is not available on this deployment. Pick a preset banner or paste an image URL instead.',
        },
        { status: 503 }
      )
    }

    const body = (await req.json().catch(() => null)) as { dataUrl?: unknown } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''
    if (!dataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Only image uploads are supported' }, { status: 400 })
    }
    if (dataUrl.length > MAX_DATAURL_CHARS) {
      return NextResponse.json({ error: 'Image is too large — please use one under 1.5MB' }, { status: 400 })
    }

    const match = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+);base64,(.+)$/i.exec(dataUrl)
    if (!match) {
      return NextResponse.json({ error: 'Malformed image data' }, { status: 400 })
    }

    const mime = match[1].toLowerCase()
    const ext = MIME_EXT[mime]
    if (!ext) {
      return NextResponse.json({ error: 'Unsupported image type — use JPEG, PNG or WebP' }, { status: 400 })
    }

    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Malformed image data' }, { status: 400 })
    }
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large — please use one under 1.5MB' }, { status: 400 })
    }

    const dir = path.join(process.cwd(), 'public', 'uploads')
    const filename = `upl_${Date.now()}_${crypto.randomBytes(2).toString('hex')}.${ext}`

    try {
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, filename), buffer)
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
        return NextResponse.json(
          {
            error:
              'This server cannot store uploads (read-only filesystem). Pick a preset banner or paste an image URL instead.',
          },
          { status: 503 }
        )
      }
      throw err
    }

    return NextResponse.json({ url: `/uploads/${filename}` })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/upload failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
  }
}
