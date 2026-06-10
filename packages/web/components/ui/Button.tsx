import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'soft' | 'danger';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  // главное действие — лайм, текст контрастный к заливке (on-accent: тёмный в тёмной теме, белый в светлой)
  primary: 'bg-accent text-on-accent hover:bg-accent-press font-medium',
  ghost: 'bg-transparent text-text hover:bg-panel-2 border border-line',
  soft: 'bg-panel-2 text-text hover:bg-line',
  danger: 'bg-transparent text-danger hover:bg-danger/10 border border-danger/30',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-5 text-sm',
};

export function Button({ variant = 'primary', size = 'md', className, ...props }: Props) {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full transition-colors disabled:opacity-40 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
