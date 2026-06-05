'use client';
import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

export function RatingStars({
  value,
  onChange,
  size = 16,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={cn(onChange && 'cursor-pointer hover:scale-110 transition-transform', !onChange && 'cursor-default')}
        >
          <Star
            size={size}
            className={n <= value ? 'fill-accent text-accent-ink' : 'text-line'}
            strokeWidth={2}
          />
        </button>
      ))}
    </div>
  );
}
