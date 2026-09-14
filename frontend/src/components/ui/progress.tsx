import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, max = 100, className, ...props }, ref) => {
    const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}
        {...props}
      >
        <div
          className="h-full rounded-full bg-indigo-600 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };
