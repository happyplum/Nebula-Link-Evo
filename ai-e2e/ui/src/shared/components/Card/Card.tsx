import React from 'react'
import { cn } from '@/lib/utils.js'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode
  actions?: React.ReactNode
  noPadding?: boolean
}

export const Card: React.FC<CardProps> = ({
  title,
  actions,
  children,
  noPadding = false,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface-2 text-card-foreground shadow-sm',
        className
      )}
      {...props}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          {title && (
            <div className="text-sm font-semibold text-text-primary">
              {title}
            </div>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(noPadding ? '' : 'p-4')}>{children}</div>
    </div>
  )
}
