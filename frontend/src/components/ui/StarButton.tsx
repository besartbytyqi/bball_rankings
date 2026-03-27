interface StarButtonProps {
  starred: boolean
  onToggle: (e: React.MouseEvent) => void
  className?: string
}

export default function StarButton({ starred, onToggle, className = '' }: StarButtonProps) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(e) }}
      title={starred ? 'Remove from featured' : 'Add to featured'}
      className={`text-base leading-none transition-colors ${starred ? 'text-nba-gold' : 'text-text-secondary/40 hover:text-nba-gold'} ${className}`}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}
