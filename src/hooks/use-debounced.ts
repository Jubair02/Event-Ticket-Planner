'use client'

import { useEffect, useState } from 'react'

/**
 * Trails a fast-changing value by `delay`.
 *
 * Search boxes keep their own state so typing stays instant; only the settled
 * value reaches the query and the address bar, so one search costs one request
 * instead of one per keystroke.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}
