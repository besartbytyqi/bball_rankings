import type { ReactNode } from 'react'

interface SectionHeaderProps {
  title: string
  right?: ReactNode
}

export default function SectionHeader({ title, right }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
      <h2 className="text-base font-semibold text-text-primary uppercase tracking-wide shrink-0">{title}</h2>
      {right && <div className="text-sm text-text-secondary w-full sm:w-auto min-w-0 sm:max-w-[min(100%,28rem)]">{right}</div>}
    </div>
  )
}
