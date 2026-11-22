import React from 'react';
import { Loader2 } from 'lucide-react';

interface GoogleAuthButtonProps {
  label?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({
  label = 'Continue with Google',
  loading = false,
  disabled = false,
  onClick,
}) => {
  return (
    <button
      type="button"
      disabled={loading || disabled}
      onClick={onClick}
      className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 hover:border-violet-400/45 text-white font-semibold text-sm flex items-center justify-center gap-3 transition-all shadow-lg shadow-black/25 disabled:opacity-60"
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-violet-300 shrink-0" />
          <span>Connecting Google...</span>
        </>
      ) : (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="w-4 h-4 shrink-0"
          >
            <path
              fill="#EA4335"
              d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.8-5.4 3.8-3.3 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
            />
            <path
              fill="#34A853"
              d="M3.6 7.4l3.2 2.3C7.7 7.8 9.7 6.5 12 6.5c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5c-3.7 0-6.9 2.1-8.4 4.9z"
            />
            <path
              fill="#FBBC05"
              d="M12 21.5c2.5 0 4.7-.8 6.2-2.3l-2.9-2.4c-.8.6-1.9 1-3.3 1-2.5 0-4.6-1.7-5.4-4l-3.2 2.5c1.5 3.1 4.8 5.2 8.6 5.2z"
            />
            <path
              fill="#4285F4"
              d="M21.1 12.2c0-.6-.1-1.1-.2-1.6H12v3.9h5.4c-.3 1.2-1 2.2-2.1 2.9l2.9 2.4c1.7-1.6 2.9-3.9 2.9-7.6z"
            />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
};
