import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div
      className="flex flex-col items-center justify-center py-24 gap-4"
      role="status"
      aria-live="polite"
      aria-label="Page not found"
    >
      <h1 className="text-4xl font-bold text-text-secondary">404</h1>
      <p className="text-text-secondary">Page not found.</p>
      <Link
        to="/"
        className="text-nba-red hover:underline text-sm rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
      >
        ← Back to dashboard
      </Link>
    </div>
  )
}
