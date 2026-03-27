import type { ReactNode } from 'react'
import Navbar from './Navbar'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

export default function AppShell({ children }: { children: ReactNode }) {
  const { pullDistance, isRefreshing } = usePullToRefresh()

  return (
    <div className="min-h-screen bg-surface text-text-primary overflow-x-hidden">
      {/* Pull to refresh indicator */}
      <div 
        className="fixed top-0 left-0 right-0 z-[60] flex justify-center pointer-events-none transition-transform duration-200"
        style={{ transform: `translateY(${pullDistance - 40}px)` }}
      >
        <div className={`bg-nba-red text-white p-2 rounded-full shadow-lg border-2 border-white/20 transition-all ${isRefreshing ? 'animate-spin' : ''}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.001 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
      </div>

      <Navbar />
      <main className={`max-w-7xl mx-auto px-4 py-6 transition-transform duration-200 ${pullDistance > 0 ? 'pointer-events-none' : ''}`} style={{ transform: `translateY(${pullDistance * 0.4}px)` }}>
        {children}
      </main>
    </div>
  )
}
