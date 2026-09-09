import type { Metadata } from 'next'
import { HomePage } from '@/components/app/home'

export const metadata: Metadata = {
  // The default title already names the product, so no override here.
  alternates: { canonical: '/' },
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city?: string; category?: string }>
}) {
  // Filters are read here rather than in the client so the correct chip is
  // active on first paint and a refresh lands on the same results.
  const { q, city, category } = await searchParams
  return <HomePage initialFilters={{ q, city, category }} />
}
