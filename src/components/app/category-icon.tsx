import { createElement } from 'react'
import {
  Briefcase,
  Cpu,
  Drama,
  Gamepad2,
  GraduationCap,
  LayoutGrid,
  Music2,
  Trophy,
  UtensilsCrossed,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * One icon per event category, shared by the category rail and the card's
 * no-banner fallback.
 *
 * These replace the emoji in `CATEGORY_LABELS`. Emoji render differently on
 * every platform, ignore `currentColor` so they cannot follow the theme, and
 * are read aloud by their unicode name — "fire", "hamburger" — which is not
 * what the label means.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  CONCERT: Music2,
  TECH: Cpu,
  WORKSHOP: GraduationCap,
  SPORTS: Trophy,
  CULTURAL: Drama,
  BUSINESS: Briefcase,
  GAMING: Gamepad2,
  FOOD: UtensilsCrossed,
}

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? LayoutGrid
}

/**
 * Renders the category's icon.
 *
 * `createElement` rather than assigning the looked-up icon to a capitalised
 * local and rendering `<Icon />`: that pattern reads to React — and to
 * `react-hooks/static-components` — as defining a fresh component on every
 * render, which costs a remount of the subtree.
 */
export function CategoryIcon({
  category,
  className,
}: {
  category: string
  className?: string
}) {
  return createElement(categoryIcon(category), { className, 'aria-hidden': 'true' })
}
