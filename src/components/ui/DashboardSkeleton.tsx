import React from 'react';
import { GlassCard } from './GlassCard';

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="space-y-5 lg:space-y-6 animate-pulse" aria-label="Loading dashboard">
      {/* Top Row Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="lg:col-span-5 p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/10 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="h-5 w-36 rounded bg-white/15" />
            <div className="h-3 w-28 rounded bg-white/10" />
          </div>
        </GlassCard>

        <GlassCard className="lg:col-span-7 p-6 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 shrink-0" />
          <div className="flex-1 space-y-2.5">
            <div className="h-3 w-28 rounded bg-white/10" />
            <div className="h-8 w-44 rounded bg-white/15" />
            <div className="h-4 w-32 rounded bg-white/10" />
          </div>
        </GlassCard>
      </div>

      {/* 4 KPI Cards Skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[1, 2, 3, 4].map((idx) => (
          <GlassCard key={idx} className="p-4 flex flex-col items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-white/10" />
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="h-7 w-16 rounded bg-white/15" />
          </GlassCard>
        ))}
      </div>

      {/* Quick Actions Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((idx) => (
          <GlassCard key={idx} className="p-4 h-20 bg-white/[0.04]" >
            <div className="h-4 w-20 rounded bg-white/10 mx-auto mt-4" />
          </GlassCard>
        ))}
      </div>

      {/* Bottom Split Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <GlassCard className="lg:col-span-6 p-5 h-56 space-y-3">
          <div className="h-4 w-32 rounded bg-white/15" />
          <div className="h-16 rounded-xl bg-white/10" />
          <div className="h-16 rounded-xl bg-white/10" />
        </GlassCard>
        <GlassCard className="lg:col-span-6 p-5 h-56 space-y-3">
          <div className="h-4 w-36 rounded bg-white/15" />
          <div className="h-12 rounded-xl bg-white/10" />
          <div className="h-12 rounded-xl bg-white/10" />
          <div className="h-12 rounded-xl bg-white/10" />
        </GlassCard>
      </div>
    </div>
  );
};
