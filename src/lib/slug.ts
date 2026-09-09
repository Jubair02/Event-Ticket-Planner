/**
 * URL slugs for events.
 *
 * Slugs are generated once, at creation, and never regenerated when a title
 * changes — a permalink that moves is a broken permalink. The event id remains
 * a valid lookup key, so any link that predates slugs still resolves.
 */

const MAX_SLUG_LENGTH = 60

/**
 * "Dhaka Tech Summit 2026" -> "dhaka-tech-summit-2026"
 *
 * Latin diacritics are folded (é -> e). Scripts without a Latin form — Bengali,
 * for instance — leave nothing behind, so callers must handle an empty result;
 * `uniqueEventSlug` falls back to a generic stem in that case rather than
 * producing a URL of pure punctuation.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    // Strip combining marks left behind by NFKD.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Drop apostrophes rather than turning them into separators, so
    // "Cox's Bazar" reads as "coxs-bazar" and not "cox-s-bazar".
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
}

/** Short random stem for titles that slugify to nothing. */
function fallbackStem(): string {
  return `event-${Math.random().toString(36).slice(2, 8)}`
}

interface SlugStore {
  event: {
    findFirst(args: {
      where: { slug: string; id?: { not: string } }
      select: { id: true }
    }): Promise<{ id: string } | null>
  }
}

/**
 * A slug that is unique across events. Collisions get a numeric suffix
 * ("dhaka-music-festival-2"), which is how a second event with the same title
 * still gets a readable URL.
 */
export async function uniqueEventSlug(
  db: SlugStore,
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(title) || fallbackStem()

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await db.event.findFirst({
      where: excludeId ? { slug: candidate, id: { not: excludeId } } : { slug: candidate },
      select: { id: true },
    })
    if (!clash) return candidate
  }

  // Effectively unreachable; keeps the return type honest.
  return `${base}-${Date.now().toString(36)}`
}

/** True when the string looks like a Prisma cuid rather than a slug. */
export function looksLikeId(value: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(value)
}
