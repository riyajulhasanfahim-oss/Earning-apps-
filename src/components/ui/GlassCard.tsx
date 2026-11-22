import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'gradient' | 'subtle';
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  variant = 'default',
  onClick,
}) => {
  const baseClass =
    variant === 'gradient'
      ? 'brand-gradient border border-white/20 shadow-xl shadow-violet-950/50'
      : variant === 'subtle'
        ? 'glass-card-subtle'
        : 'glass-card';

  const interactiveClass = onClick
    ? 'cursor-pointer hover:border-violet-400/35 transition-colors duration-150'
    : '';

  return (
    <div
      onClick={onClick}
      className={`rounded-2xl ${baseClass} ${interactiveClass} ${className}`}
    >
      {children}
    </div>
  );
};
