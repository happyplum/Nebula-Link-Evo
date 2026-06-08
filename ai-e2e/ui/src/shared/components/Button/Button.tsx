import React from 'react'
import { cn } from '@/lib/utils.js'
import { Loader2Icon } from 'lucide-react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
}

const variantClasses: Record<string, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border shadow-xs',
  danger:
    'bg-destructive text-white hover:bg-destructive/90 shadow-xs',
  ghost:
    'hover:bg-accent hover:text-accent-foreground',
}

const sizeClasses: Record<string, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-xs',
  md: 'h-9 gap-2 rounded-md px-4 text-sm',
  lg: 'h-10 gap-2 rounded-md px-6 text-sm',
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  disabled,
  ...props
}) => {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2Icon className="size-4 animate-spin" />}
      <span>{children}</span>
    </button>
  )
}
