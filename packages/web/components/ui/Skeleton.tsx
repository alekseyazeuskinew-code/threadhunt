import { cn } from '@/lib/cn';

// Мягкий «скелетон» загрузки — плавный пульс вместо текста «Загрузка…».
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-panel-2', className)} />;
}

// Несколько карточек-заглушек (для списков/канбана/лент).
export function CardsSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
