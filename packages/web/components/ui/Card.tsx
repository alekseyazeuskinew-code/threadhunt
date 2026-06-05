import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('anim-up rounded-2xl border border-line bg-panel p-5', className)} {...props} />;
}
