import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Delete, KeyRound, Loader2, ShieldCheck, Zap } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export function LoginPage(): JSX.Element {
  const { loginWithPin, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitPin = useCallback(
    async (code: string): Promise<void> => {
      setError('');
      setSubmitting(true);
      try {
        await loginWithPin(code);
        navigate('/dashboard', { replace: true });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Invalid PIN. Please try again.');
        setPin('');
      } finally {
        setSubmitting(false);
      }
    },
    [loginWithPin, navigate],
  );

  const handleDigit = useCallback(
    (digit: string) => {
      if (submitting) return;
      if (pin.length < 4) {
        const next = pin + digit;
        setPin(next);
        setError('');
        if (next.length === 4) {
          void submitPin(next);
        }
      }
    },
    [pin, submitting, submitPin],
  );

  const handleBackspace = useCallback(() => {
    if (submitting) return;
    setPin((p) => p.slice(0, -1));
    setError('');
  }, [submitting]);

  const handleClear = useCallback(() => {
    if (submitting) return;
    setPin('');
    setError('');
  }, [submitting]);

  // Physical keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDigit, handleBackspace, handleClear]);

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      </div>
    );
  }
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  const keypadData = [
    { num: '1', sub: '' },
    { num: '2', sub: 'ABC' },
    { num: '3', sub: 'DEF' },
    { num: '4', sub: 'GHI' },
    { num: '5', sub: 'JKL' },
    { num: '6', sub: 'MNO' },
    { num: '7', sub: 'PQRS' },
    { num: '8', sub: 'TUV' },
    { num: '9', sub: 'WXYZ' },
  ];

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-[#0B0F19] px-4 py-8 select-none">
      {/* Decorative ambient background glows */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-[450px] w-[450px] rounded-full bg-blue-600/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-[450px] w-[450px] rounded-full bg-indigo-600/15 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />

      <div className="relative z-10 w-full max-w-[400px]">
        {/* Header Branding */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-500 via-indigo-500 to-violet-600 text-white shadow-xl shadow-blue-500/30 ring-4 ring-slate-800">
            <Boxes className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            SANTU HARDWARE
          </h1>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">
            Store POS Terminal
          </p>
        </div>

        {/* PIN Pad Card */}
        <div className="rounded-3xl border border-slate-800/90 bg-slate-900/85 p-6 shadow-2xl backdrop-blur-2xl sm:p-8">
          <div className="mb-5 text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-400 ring-1 ring-blue-500/20">
              <KeyRound className="h-3.5 w-3.5" />
              <span>Enter Store PIN</span>
            </div>
            <p className="mt-2 text-xs font-medium text-slate-400">
              Fast unlock with PIN <strong className="text-white">5644</strong>
            </p>
          </div>

          {/* 4 PIN Dots */}
          <div className="mb-7 flex items-center justify-center gap-4">
            {[0, 1, 2, 3].map((index) => {
              const isFilled = pin.length > index;
              return (
                <div
                  key={index}
                  className={cn(
                    'flex h-14 w-14 items-center justify-center rounded-2xl border-2 transition-all duration-200',
                    isFilled
                      ? 'border-blue-500 bg-blue-500/15 shadow-lg shadow-blue-500/25 scale-105'
                      : 'border-slate-800 bg-slate-800/40',
                    error && 'border-rose-500 bg-rose-500/20',
                  )}
                >
                  {isFilled && (
                    <div className="h-4 w-4 rounded-full bg-gradient-to-tr from-blue-400 to-indigo-400 shadow-md shadow-blue-400" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Error Message */}
          {error && (
            <p className="mb-4 text-center text-xs font-bold text-rose-400 animate-fade-in">
              {error}
            </p>
          )}

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-2.5">
            {keypadData.map(({ num, sub }) => (
              <button
                key={num}
                type="button"
                onClick={() => handleDigit(num)}
                disabled={submitting}
                className="group flex h-16 flex-col items-center justify-center rounded-2xl border border-slate-800/90 bg-slate-800/60 shadow-xs transition-all hover:border-slate-700 hover:bg-slate-750 active:scale-95 active:bg-blue-600/30 disabled:opacity-50"
              >
                <span className="text-2xl font-extrabold text-white group-hover:text-blue-400 transition-colors">
                  {num}
                </span>
                {sub && (
                  <span className="text-[9px] font-bold tracking-widest text-slate-400">
                    {sub}
                  </span>
                )}
              </button>
            ))}

            {/* Clear Button */}
            <button
              type="button"
              onClick={handleClear}
              disabled={submitting || pin.length === 0}
              className="flex h-16 items-center justify-center rounded-2xl border border-slate-800/90 bg-slate-800/40 text-xs font-bold uppercase tracking-wider text-slate-400 shadow-xs transition-all hover:bg-slate-800 hover:text-white active:scale-95 disabled:opacity-30"
            >
              Clear
            </button>

            {/* 0 Button */}
            <button
              type="button"
              onClick={() => handleDigit('0')}
              disabled={submitting}
              className="group flex h-16 flex-col items-center justify-center rounded-2xl border border-slate-800/90 bg-slate-800/60 shadow-xs transition-all hover:border-slate-700 hover:bg-slate-750 active:scale-95 active:bg-blue-600/30 disabled:opacity-50"
            >
              <span className="text-2xl font-extrabold text-white group-hover:text-blue-400 transition-colors">
                0
              </span>
              <span className="text-[9px] font-bold tracking-widest text-slate-400">+</span>
            </button>

            {/* Backspace Button */}
            <button
              type="button"
              onClick={handleBackspace}
              disabled={submitting || pin.length === 0}
              className="flex h-16 items-center justify-center rounded-2xl border border-slate-800/90 bg-slate-800/40 text-slate-400 shadow-xs transition-all hover:bg-slate-800 hover:text-rose-400 active:scale-95 disabled:opacity-30"
              aria-label="Backspace"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>

          {/* Loading Indicator */}
          {submitting && (
            <div className="mt-5 flex items-center justify-center gap-2 text-xs font-bold text-blue-400 animate-fade-in">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              <span>Verifying Store PIN...</span>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-5 text-center">
          <div className="flex items-center justify-center gap-3 text-xs font-medium text-slate-500">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400" /> Instant POS Unlock
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Station 1 Active
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
