import React, { useEffect, useRef } from 'react';

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  className?: string;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  prefix = '',
  suffix = '',
  durationMs = 480,
  className = '',
}) => {
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const previousRef = useRef(value);

  useEffect(() => {
    const el = valueRef.current;
    if (!el) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (
      prefersReduced ||
      previousRef.current === value ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      previousRef.current = value;
      el.textContent = value.toLocaleString('en-US');
      return;
    }

    const startVal = previousRef.current;
    const diff = value - startVal;
    const startTime = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextDisplay = Math.round(startVal + diff * eased);
      el.textContent = nextDisplay.toLocaleString('en-US');

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        previousRef.current = value;
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
      previousRef.current = value;
    };
  }, [value, durationMs]);

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      <span ref={valueRef}>{value.toLocaleString('en-US')}</span>
      {suffix}
    </span>
  );
};
