import * as React from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function TagInput({
  value = [],
  onChange,
  placeholder = "输入后按回车添加，支持粘贴多行",
  disabled = false,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = React.useState("")

  const addTags = (rawTokens: string[]) => {
    const tokensToAdd = rawTokens
      .map(t => t.trim())
      .filter(t => t.length > 0)
    if (tokensToAdd.length === 0) return

    const newSet = new Set(value)
    tokensToAdd.forEach(t => newSet.add(t))
    onChange(Array.from(newSet))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      if (inputValue.trim()) {
        addTags([inputValue])
        setInputValue("")
      }
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      // Remove last tag if backspace on empty input
      removeTag(value.length - 1)
    }
  }

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTags([inputValue])
      setInputValue("")
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text")
    if (pasted.includes("\n") || pasted.includes(",") || pasted.includes(" ")) {
      e.preventDefault()
      const tokens = pasted.split(/[\r\n, ]+/)
      addTags(tokens)
      setInputValue("")
    }
  }

  const removeTag = (indexToRemove: number) => {
    onChange(value.filter((_, idx) => idx !== indexToRemove))
  }

  const clearAll = () => {
    onChange([])
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2 items-center">
        <Input
          disabled={disabled}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={placeholder}
          className="flex-1 rounded-xl border-border bg-background font-mono text-xs h-9"
        />
        {value.length > 0 && !disabled && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg border border-border/60 hover:bg-accent/40 shrink-0"
          >
            清空 ({value.length})
          </button>
        )}
      </div>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-xl border border-border/70 bg-secondary/20 max-h-36 overflow-y-auto">
          {value.map((tag, idx) => (
            <Badge
              key={`${tag}-${idx}`}
              variant="secondary"
              className="font-mono text-[11px] py-0.5 pl-2 pr-1 gap-1 border border-border/60 bg-background/80 text-foreground"
            >
              <span>{tag}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeTag(idx)}
                  className="hover:bg-muted p-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`移除 ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/70 italic px-1">
          暂无已配置的 OpenID（输入或粘贴后回车添加）
        </div>
      )}
    </div>
  )
}
