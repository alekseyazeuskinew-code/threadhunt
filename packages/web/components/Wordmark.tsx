import { cn } from '@/lib/cn';

// Вордмарк: две лаймовые «нити» + threadhunt строчными (Space Grotesk).
export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display font-semibold tracking-tight', className)}>
      <span aria-hidden className="text-accent-ink leading-none">⟋⟋</span>
      {!compact && <span className="text-text">threadhunt</span>}
    </span>
  );
}
