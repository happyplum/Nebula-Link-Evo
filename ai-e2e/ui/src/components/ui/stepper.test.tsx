import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { Stepper, StepperItem } from './stepper.js'
import type { Step } from './stepper.js'

const steps: Step[] = [
  { id: 'prepare', label: '准备' },
  { id: 'understand', label: '理解' },
  { id: 'explore', label: '探索' },
  { id: 'run', label: '生成与运行' },
]

function getItem(container: HTMLElement, status: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-status="${status}"]`)
  if (!el) throw new Error(`No item with status=${status}`)
  return el
}

describe('Stepper', () => {
  it('completed step shows checkmark', () => {
    const { container } = render(<Stepper steps={steps} activeStep={1} />)
    const completed = getItem(container, 'completed')
    // Lucide CheckIcon renders as an <svg>
    expect(completed.querySelector('svg')).not.toBeNull()
  })

  it('current step is highlighted', () => {
    const { container } = render(<Stepper steps={steps} activeStep={1} />)
    const current = getItem(container, 'current')
    const button = current.querySelector('button')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-current')).toBe('step')
  })

  it('pending step is greyed', () => {
    const { container } = render(<Stepper steps={steps} activeStep={1} />)
    const pending = getItem(container, 'pending')
    const button = pending.querySelector('button')
    expect(button).not.toBeNull()
    expect(button?.hasAttribute('disabled')).toBe(true)
  })

  it('vertical orientation renders labels', () => {
    render(<Stepper steps={steps} activeStep={0} orientation="vertical" />)
    expect(screen.getByText('准备')).toBeInTheDocument()
    expect(screen.getByText('生成与运行')).toBeInTheDocument()
  })

  it('renders explicit step.status over activeStep derivation', () => {
    const explicit: Step[] = [
      { id: 'a', label: 'A', status: 'completed' },
      { id: 'b', label: 'B', status: 'current' },
      { id: 'c', label: 'C', status: 'pending' },
    ]
    const { container } = render(<Stepper steps={explicit} activeStep={0} />)
    expect(getItem(container, 'completed')).toBeDefined()
    expect(getItem(container, 'current')).toBeDefined()
    expect(getItem(container, 'pending')).toBeDefined()
  })

  it('calls onStepClick with step id and index', () => {
    const onClick = vi.fn()
    render(<Stepper steps={steps} activeStep={1} onStepClick={onClick} />)
    fireEvent.click(screen.getByText('准备'))
    expect(onClick).toHaveBeenCalledWith('prepare', 0)
  })

  it('renders description when provided', () => {
    render(
      <Stepper
        steps={[{ id: 'a', label: '步骤A', description: '描述A' }]}
        activeStep={0}
      />,
    )
    expect(screen.getByText('描述A')).toBeInTheDocument()
  })

  it('supports composed StepperItem children', () => {
    render(
      <Stepper orientation="vertical">
        <StepperItem status="completed" stepNumber={1} label="已完成步骤" />
        <StepperItem status="current" stepNumber={2} label="当前步骤" />
      </Stepper>,
    )
    expect(screen.getByText('已完成步骤')).toBeInTheDocument()
    expect(screen.getByText('当前步骤')).toBeInTheDocument()
  })
})
