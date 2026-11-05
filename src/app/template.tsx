'use client';
import { motion, useReducedMotion } from 'motion/react';
export default function Template({ children }: { children: React.ReactNode }) { const reduced = useReducedMotion(); return <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>{children}</motion.div>; }
