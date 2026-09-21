import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((list) => [...list, { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ tone: 'success', title, description }),
      error: (title, description) => toast({ tone: 'error', title, description }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
          {toasts.map((t) => {
            const Icon = icons[t.tone];
            const iconBg = {
              success: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200',
              error: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
              warning: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200',
              info: 'bg-blue-50 text-blue-600 ring-1 ring-blue-200',
            } as const;

            return (
              <div
                key={t.id}
                role="status"
                className={cn(
                  'pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3',
                  'rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-lift backdrop-blur-md ring-1 ring-black/5',
                )}
              >
                <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', iconBg[t.tone])}>
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-bold text-slate-900">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs font-medium text-slate-500">{t.description}</p>}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
