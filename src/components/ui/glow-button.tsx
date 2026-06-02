import { type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function GlowButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn('btn-glow', className)} {...props} />;
}
