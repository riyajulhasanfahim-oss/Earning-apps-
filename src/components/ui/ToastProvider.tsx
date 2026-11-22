import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-2), { id, type, message }]);
      window.setTimeout(() => {
        dismiss(id);
      }, 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((toast) => {
          const styles =
            toast.type === 'success'
              ? 'border-emerald-400/40 bg-[#0A1D24]/95 text-emerald-100'
              : toast.type === 'error'
                ? 'border-rose-400/40 bg-[#220C1C]/95 text-rose-100'
                : 'border-violet-400/40 bg-[#111738]/95 text-slate-100';

          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error'
                ? AlertCircle
                : Info;

          const iconColor =
            toast.type === 'success'
              ? 'text-emerald-400'
              : toast.type === 'error'
                ? 'text-rose-400'
                : 'text-violet-400';

          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl flex items-start gap-3 ${styles}`}
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
              <p className="text-xs sm:text-sm font-medium flex-1 leading-relaxed">
                {toast.message}
              </p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="min-h-[32px] min-w-[32px] -mr-1 -mt-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
