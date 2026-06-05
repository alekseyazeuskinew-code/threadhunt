'use client';
import { cn } from '@/lib/cn';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

// Единственный тумблер на карточку — принцип «мало кнопок».
export function Toggle({ checked, onChange, disabled, ...rest }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-panel-2 border border-line',
      )}
      {...rest}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full transition-transform',
          checked ? 'left-0.5 translate-x-5 bg-on-accent' : 'left-0.5 bg-muted',
        )}
      />
    </button>
  );
}
