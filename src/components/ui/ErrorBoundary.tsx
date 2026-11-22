import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { GlassCard } from './GlassCard';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Uncaught application error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center p-4 bg-[#06091B] text-slate-100">
          <GlassCard className="max-w-md w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-400 mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-extrabold font-display text-white">
              Something went wrong
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed break-words">
              {this.state.errorMessage || 'An unexpected error occurred while syncing data.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reload Application</span>
            </button>
          </GlassCard>
        </div>
      );
    }

    return this.props.children;
  }
}
