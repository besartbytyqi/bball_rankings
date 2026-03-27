export default function ErrorCard({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="bg-surface-2 border border-nba-red/40 rounded-lg p-6 text-center">
      <p className="text-text-secondary mb-3">{message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-1.5 bg-nba-red text-white text-sm rounded hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}
