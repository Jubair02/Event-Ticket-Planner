'use client'

import { motion, useReducedMotion } from 'framer-motion'

/**
 * Route transition. `template.tsx` remounts on every navigation, which is what
 * preserves the cross-view fade the single-page shell used to get from
 * AnimatePresence — now driven by the URL instead of view state.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) return <>{children}</>

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
