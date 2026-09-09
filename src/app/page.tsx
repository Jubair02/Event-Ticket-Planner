import type { Metadata } from 'next'
import { HomePage } from '@/components/app/home'

export const metadata: Metadata = {
  // The default title already names the product, so no override here.
  alternates: { canonical: '/' },
}

export default function Home() {
  return <HomePage />
}
