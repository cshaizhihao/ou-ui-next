import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('island-card ou-card', className)} {...props} />;
}
