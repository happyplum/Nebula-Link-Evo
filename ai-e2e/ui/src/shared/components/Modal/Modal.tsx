import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils.js'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string | number
  closeOnOverlayClick?: boolean
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  width = 500,
  closeOnOverlayClick = true,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnOverlayClick) {
      onClose()
    }
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-in fade-in-0"
      onClick={handleOverlayClick}
    >
      <div
        className={cn(
          'grid w-full gap-4 rounded-lg border bg-background p-6 shadow-lg animate-in zoom-in-95'
        )}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold leading-none tracking-tight">
              {title}
            </div>
            <button
              className="rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              onClick={onClose}
              aria-label="关闭"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        )}
        <div>{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
