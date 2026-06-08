import React, { forwardRef } from 'react'
import { cn } from '@/lib/utils.js'

export interface CodeEditorProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  language?: string
  label?: string
  error?: string
}

export const CodeEditor = forwardRef<HTMLTextAreaElement, CodeEditorProps>(
  ({ language = 'json', label, error, className, id, ...props }, ref) => {
    const editorId =
      id || `editor-${Math.random().toString(36).substr(2, 9)}`

    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label && (
          <div className="flex items-center justify-between">
            <label
              htmlFor={editorId}
              className="text-sm font-medium text-text-primary"
            >
              {label}
            </label>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {language}
            </span>
          </div>
        )}
        <div className="relative">
          <textarea
            ref={ref}
            id={editorId}
            className={cn(
              'min-h-[200px] w-full rounded-md border bg-surface-content px-3 py-2 font-mono text-sm leading-relaxed text-text-primary shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50',
              error
                ? 'border-destructive focus-visible:ring-destructive'
                : 'border-input focus-visible:ring-ring'
            )}
            spellCheck={false}
            {...props}
          />
        </div>
        {error && (
          <span className="text-xs text-destructive">{error}</span>
        )}
      </div>
    )
  }
)

CodeEditor.displayName = 'CodeEditor'
