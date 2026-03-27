import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type SortableDragHandleProps = {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
}

type SortableFeaturedStripProps = {
  /** Order from the server; when this sequence changes, local order syncs (unless mid-drag). */
  serverOrderedIds: string[]
  onCommit: (orderedIds: string[]) => Promise<void>
  gridClassName?: string
  /** Render each card; attach handle props only to the drag handle control. */
  renderItem: (id: string, handle: SortableDragHandleProps, isDragging: boolean) => ReactNode
  /** Floating preview under the cursor */
  renderOverlay: (id: string) => ReactNode
}

function SortableItem({
  id,
  children,
}: {
  id: string
  children: (handle: SortableDragHandleProps, isDragging: boolean) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: 'none' as const,
  }
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'z-[1]' : ''}>
      {children({ attributes, listeners }, isDragging)}
    </div>
  )
}

export function SortableFeaturedStrip({
  serverOrderedIds,
  onCommit,
  gridClassName = 'grid grid-cols-2 sm:grid-cols-4 gap-3',
  renderItem,
  renderOverlay,
}: SortableFeaturedStripProps) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => [...serverOrderedIds])
  const [activeId, setActiveId] = useState<string | null>(null)
  const orderedIdsRef = useRef<string[]>(orderedIds)
  const snapshotRef = useRef<string[] | null>(null)
  const commitInFlight = useRef(false)

  const serverKey = serverOrderedIds.join('\u0001')
  useEffect(() => {
    if (activeId != null) return
    const next = [...serverOrderedIds]
    orderedIdsRef.current = next
    setOrderedIds(next)
  }, [serverKey, activeId, serverOrderedIds])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    snapshotRef.current = [...orderedIdsRef.current]
    setActiveId(String(event.active.id))
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const items = orderedIdsRef.current
    const oldIndex = items.indexOf(String(active.id))
    const newIndex = items.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(items, oldIndex, newIndex)
    orderedIdsRef.current = next
    setOrderedIds(next)
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { over } = event
      setActiveId(null)
      if (!over) {
        if (snapshotRef.current) {
          orderedIdsRef.current = snapshotRef.current
          setOrderedIds(snapshotRef.current)
        }
        snapshotRef.current = null
        return
      }
      const finalIds = orderedIdsRef.current
      const snap = snapshotRef.current
      snapshotRef.current = null
      if (!snap || finalIds.join('\u0001') === snap.join('\u0001')) return
      if (commitInFlight.current) return
      commitInFlight.current = true
      try {
        await onCommit(finalIds)
      } finally {
        commitInFlight.current = false
      }
    },
    [onCommit],
  )

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
    if (snapshotRef.current) {
      orderedIdsRef.current = snapshotRef.current
      setOrderedIds(snapshotRef.current)
    }
    snapshotRef.current = null
  }, [])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
        <div className={gridClassName}>
          {orderedIds.map((id) => (
            <SortableItem key={id} id={id}>
              {(handle, isDragging) => renderItem(id, handle, isDragging)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
        {activeId ? (
          <div className="cursor-grabbing shadow-2xl ring-2 ring-sky-500/60 rounded-lg overflow-hidden rotate-[1deg] scale-[1.02]">
            {renderOverlay(activeId)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
