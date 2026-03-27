import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { client } from '@/api/client'

export function usePullToRefresh() {
  const queryClient = useQueryClient()
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    let startY = 0
    const threshold = 100

    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].pageY
      } else {
        startY = 0
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (startY === 0 || isRefreshing) return
      const currentY = e.touches[0].pageY
      const diff = currentY - startY
      if (diff > 0) {
        setPullDistance(Math.min(diff, threshold + 20))
        if (diff > threshold) {
          if (e.cancelable) e.preventDefault()
        }
      }
    }

    const handleTouchEnd = async () => {
      if (pullDistance > threshold && !isRefreshing) {
        setIsRefreshing(true)
        setPullDistance(threshold)

        try {
          await client.post('/refresh?quick=true')
          await queryClient.invalidateQueries()
          await new Promise((r) => setTimeout(r, 400))
        } catch {
          await queryClient.invalidateQueries()
          await new Promise((r) => setTimeout(r, 400))
        } finally {
          setIsRefreshing(false)
          setPullDistance(0)
        }
      } else {
        setPullDistance(0)
      }
      startY = 0
    }

    window.addEventListener('touchstart', handleTouchStart)
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [pullDistance, isRefreshing, queryClient])

  return { pullDistance, isRefreshing }
}
