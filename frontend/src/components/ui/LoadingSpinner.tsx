export default function LoadingSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-text-secondary">
      <div className="w-5 h-5 border-2 border-nba-red border-t-transparent rounded-full animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  )
}
