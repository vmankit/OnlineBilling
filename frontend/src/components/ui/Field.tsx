import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-xl border border-slate-200/90 bg-white px-4 text-[15px] text-slate-900 ' +
  'placeholder:text-slate-400 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all focus-ring hover:border-slate-300 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

export function Label({
  htmlFor,
  children,
  required,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-sm font-medium text-slate-700', className)}>
      {children}
      {required && <span className="ml-0.5 text-rose-500">*</span>}
    </label>
  );
}

export function FieldError({ children }: { children?: ReactNode }): JSX.Element | null {
  if (!children) return null;
  return <p className="mt-1.5 text-sm text-rose-600">{children}</p>;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(control, 'h-12', invalid && 'border-rose-300 bg-rose-50/40', className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(control, 'h-12 pr-10', className)} {...props}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} rows={3} className={cn(control, 'py-3', className)} {...props} />;
  },
);
