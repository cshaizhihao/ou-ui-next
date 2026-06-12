import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('island-panel ou-panel', className)} {...props} />;
}
