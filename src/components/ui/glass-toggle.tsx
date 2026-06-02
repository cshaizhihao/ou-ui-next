import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export const GlassToggle = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'checkbox', ...props }, ref) => (
    <input ref={ref} type={type} className={cn('glass-toggle', className)} {...props} />
  )
);

GlassToggle.displayName = 'GlassToggle';
