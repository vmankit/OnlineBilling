import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={cn('card', className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={cn('p-5', className)}>{children}</div>;
}

export function Badge({
  tone = 'slate',
  children,
  className,
}: {
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue';
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const tones = {
    slate: 'bg-slate-100/90 text-slate-700 border border-slate-200/60',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200/70',
    amber: 'bg-amber-50 text-amber-700 border border-amber-200/70',
    red: 'bg-rose-50 text-rose-700 border border-rose-200/70',
    blue: 'bg-blue-50 text-blue-700 border border-blue-200/70',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-tight',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/60', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-slate-50 to-slate-100/80 text-slate-500 shadow-sm ring-1 ring-slate-200/80">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
