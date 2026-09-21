import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 hover:shadow-glow active:from-blue-800 active:to-indigo-800',
  secondary: 'bg-white text-slate-700 border border-slate-200/90 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 shadow-sm',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 active:bg-slate-200/70',
  danger: 'bg-gradient-to-r from-rose-600 to-red-600 text-white hover:from-rose-700 hover:to-red-700 active:from-rose-800 active:to-red-800 shadow-sm',
  success: 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 active:from-emerald-800 active:to-teal-800 shadow-sm',
};

// Every size clears the 44px iPad touch target.
const sizes: Record<Size, string> = {
  sm: 'h-11 px-4 text-sm rounded-xl gap-1.5',
  md: 'h-12 px-5 text-[15px] rounded-xl gap-2',
  lg: 'h-14 px-7 text-base rounded-2xl gap-2.5',
  icon: 'h-12 w-12 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-all',
        'focus-ring disabled:cursor-not-allowed disabled:opacity-50',
        'active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
