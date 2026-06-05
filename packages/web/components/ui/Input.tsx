import { cn } from '@/lib/cn';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

const base =
  'w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-text placeholder:text-muted outline-none transition-colors focus:border-accent';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'min-h-24 resize-y', className)} {...props} />;
}
