import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';

const tones: Record<Tone, string> = {
  neutral: 'bg-panel-2 text-muted',
  accent: 'bg-accent-soft text-accent-ink',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', tones[tone], className)}
      {...props}
    />
  );
}
