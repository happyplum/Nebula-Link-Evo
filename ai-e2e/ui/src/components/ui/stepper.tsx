import * as React from 'react'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils.js'

/** Lifecycle status of a single step. */
export type StepStatus = 'pending' | 'current' | 'completed'

/** A single step in the data-driven API. */
export interface Step {
  id: string
  label: string
  description?: string
  /** When omitted, status is derived from `activeStep` index. */
  status?: StepStatus
}

type Orientation = 'horizontal' | 'vertical'

interface StepperContextValue {
  orientation: Orientation
}

const StepperContext = React.createContext<StepperContextValue>({
  orientation: 'horizontal',
})

export interface StepperProps {
  /** Data-driven steps. Status is derived from `activeStep` unless `step.status` is set. */
  steps?: Step[]
  /** 0-based index of the active step. Ignored when every step sets an explicit `status`. */
  activeStep?: number
  orientation?: Orientation
  /** Called with `(stepId, index)` when a non-pending step is clicked. */
  onStepClick?: (stepId: string, index: number) => void
  className?: string
  /** Composed mode: one or more <StepperItem /> children. */
  children?: React.ReactNode
}

export interface StepperItemProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick'> {
  status: StepStatus
  /** 1-based display number shown for current/pending steps. */
  stepNumber?: number
  label?: string
  description?: string
  /** When provided and status !== 'pending', the item is interactive. */
  onClick?: () => void
  /** Hide the trailing connector. Set on the last item. */
  isLast?: boolean
  /** Overrides the parent <Stepper orientation>. */
  orientation?: Orientation
}

function resolveStatus(step: Step, index: number, activeStep: number): StepStatus {
  if (step.status) return step.status
  if (index < activeStep) return 'completed'
  if (index === activeStep) return 'current'
  return 'pending'
}

/**
 * Wizard step indicator. Supports a data-driven API
 * (`<Stepper steps={...} activeStep={n} onStepClick={fn} />`) and a composed
 * shadcn-style API (`<Stepper><StepperItem ... /></Stepper>`).
 */
export function Stepper({
  steps,
  activeStep = 0,
  orientation = 'horizontal',
  onStepClick,
  className,
  children,
}: StepperProps) {
  const ctxValue = React.useMemo(() => ({ orientation }), [orientation])
  const listClass =
    orientation === 'vertical' ? 'flex flex-col' : 'flex items-center gap-2'

  // Data-driven mode
  if (steps && steps.length > 0) {
    const resolved = steps.map((step, index) => ({
      ...step,
      status: resolveStatus(step, index, activeStep),
    }))
    return (
      <StepperContext.Provider value={ctxValue}>
        <nav aria-label="Progress" className={cn('w-full', className)}>
          <ol className={listClass}>
            {resolved.map((step, index) => (
              <StepperItem
                key={step.id}
                status={step.status}
                stepNumber={index + 1}
                label={step.label}
                description={step.description}
                isLast={index === resolved.length - 1}
                onClick={
                  onStepClick ? () => onStepClick(step.id, index) : undefined
                }
              />
            ))}
          </ol>
        </nav>
      </StepperContext.Provider>
    )
  }

  // Composed mode
  return (
    <StepperContext.Provider value={ctxValue}>
      <nav aria-label="Progress" className={cn('w-full', className)}>
        <ol className={listClass}>{children}</ol>
      </nav>
    </StepperContext.Provider>
  )
}

function useOrientation(local?: Orientation): Orientation {
  const ctx = React.useContext(StepperContext)
  return local ?? ctx.orientation
}

export function StepperItem({
  status,
  stepNumber,
  label,
  description,
  onClick,
  isLast = false,
  orientation: orientationProp,
  className,
  ...props
}: StepperItemProps) {
  const orientation = useOrientation(orientationProp)
  const vertical = orientation === 'vertical'
  const clickable = !!onClick && status !== 'pending'

  const indicator = (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        status === 'completed' && 'bg-status-success text-white',
        status === 'current' && 'bg-status-info text-white',
        status === 'pending' && 'border border-border-default text-text-muted',
      )}
    >
      {status === 'completed' ? (
        <CheckIcon className="size-3" aria-hidden="true" />
      ) : (
        stepNumber
      )}
    </span>
  )

  const labelBlock =
    label || description ? (
      <span className="flex flex-col">
        {label ? (
          <span className="text-[13px] font-medium text-text-primary">
            {label}
          </span>
        ) : null}
        {description ? (
          <span className="text-xs text-text-secondary">{description}</span>
        ) : null}
      </span>
    ) : null

  const buttonClass = cn(
    'flex items-start gap-2 rounded-sm px-3 py-2 text-left transition-colors',
    vertical && 'items-start',
    status === 'current' && 'bg-surface-elevated text-text-primary',
    status === 'completed' &&
      'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
    status === 'pending' && 'cursor-not-allowed text-text-muted',
    clickable && 'cursor-pointer',
  )

  if (vertical) {
    return (
      <li
        data-slot="stepper-item"
        data-status={status}
        className={cn('relative flex flex-col pb-4 last:pb-0', className)}
        {...props}
      >
        {!isLast && (
          <span
            data-slot="stepper-connector"
            aria-hidden="true"
            className={cn(
              'absolute left-3 top-8 h-[calc(100%-2rem)] w-px',
              status === 'completed'
                ? 'bg-status-success'
                : 'bg-border-default',
            )}
          />
        )}
        <button
          type="button"
          onClick={() => clickable && onClick?.()}
          disabled={!clickable}
          aria-current={status === 'current' ? 'step' : undefined}
          className={buttonClass}
        >
          {indicator}
          {labelBlock}
        </button>
      </li>
    )
  }

  return (
    <li
      data-slot="stepper-item"
      data-status={status}
      className={cn('flex flex-1 items-center', !isLast && 'gap-2', className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => clickable && onClick?.()}
        disabled={!clickable}
        aria-current={status === 'current' ? 'step' : undefined}
        className={buttonClass}
      >
        {indicator}
        {labelBlock}
      </button>
      {!isLast && (
        <div
          data-slot="stepper-connector"
          aria-hidden="true"
          className={cn(
            'h-px flex-1',
            status === 'completed' ? 'bg-status-success' : 'bg-border-default',
          )}
        />
      )}
    </li>
  )
}
