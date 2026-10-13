import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ScopeItem {
  id: string
  name: string
  subtitle?: string
}

interface ScopeSelectorPopoverProps {
  title: string
  icon: React.ComponentType<{ className?: string }>
  items: ScopeItem[]
  selectedIds: string[]
  onToggle: (id: string) => void
  onSelectAll: () => void
  onClearAll: () => void
  accentType?: 'emerald' | 'amber'
  emptyMessage?: string
}

export function ScopeSelectorPopover({
  title,
  icon: Icon,
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
  accentType = 'emerald',
  emptyMessage = '暂无可用资源',
}: ScopeSelectorPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedCount = selectedIds.length
  const totalCount = items.length
  const isAllSelected = totalCount > 0 && selectedCount === totalCount

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q))
    )
  }, [items, search])

  // Get list of selected names for tooltip
  const selectedNames = useMemo(() => {
    const selectedMap = new Map(items.map((i) => [i.id, i.name]))
    return selectedIds.map((id) => selectedMap.get(id)).filter(Boolean) as string[]
  }, [items, selectedIds])

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setSearch('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Trigger styling based on active selection
  const triggerActiveClass =
    accentType === 'emerald'
      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
      : 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium'

  const checkActiveClass =
    accentType === 'emerald'
      ? 'bg-emerald-600 text-white border-emerald-600'
      : 'bg-amber-600 text-white border-amber-600'

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Popover Trigger Capsule */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] transition-colors cursor-pointer',
          selectedCount > 0
            ? triggerActiveClass
            : 'border-border text-muted-foreground hover:bg-muted/60'
        )}
        title={
          selectedNames.length > 0
            ? `${title}已挂载 (${selectedCount}): ${selectedNames.join(', ')}`
            : `点击展开选择${title}`
        }
      >
        <Icon className="w-3 h-3 shrink-0" />
        <span>
          {title} {selectedCount > 0 ? `(${selectedCount})` : ''}
        </span>
        <ChevronDown
          className={cn(
            'w-3 h-3 transition-transform duration-200 opacity-70',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full mt-1.5 left-0 z-50 w-72 max-w-[90vw] rounded-xl border border-border bg-popover text-popover-foreground shadow-lg p-2.5 space-y-2 animate-in fade-in-0 zoom-in-95">
          {/* Header Info & Quick Actions */}
          <div className="flex items-center justify-between px-1 pb-1 border-b border-border/60">
            <span className="text-xs font-semibold text-foreground">
              {title}{' '}
              <span className="text-muted-foreground font-normal">
                (已选 {selectedCount}/{totalCount})
              </span>
            </span>

            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={isAllSelected ? onClearAll : onSelectAll}
                disabled={totalCount === 0}
                className="text-primary hover:underline font-medium cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                {isAllSelected ? '清空' : '全选'}
              </button>
              {selectedCount > 0 && !isAllSelected && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  清空
                </button>
              )}
            </div>
          </div>

          {/* Search Filter (if > 5 items) */}
          {totalCount > 5 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`过滤${title}...`}
                className="w-full text-xs pl-8 pr-7 py-1 rounded-lg border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* List Items */}
          <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
            {totalCount === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {emptyMessage}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                未找到匹配结果
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedIds.includes(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onToggle(item.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-accent/70 text-foreground font-medium'
                        : 'text-foreground/80 hover:bg-accent/40'
                    )}
                  >
                    {/* Checkbox box */}
                    <div
                      className={cn(
                        'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors',
                        isSelected
                          ? checkActiveClass
                          : 'border-muted-foreground/40 bg-background'
                      )}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs">{item.name}</div>
                      {item.subtitle && (
                        <div className="truncate text-[10px] text-muted-foreground">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
