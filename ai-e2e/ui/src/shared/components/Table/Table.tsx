import React from 'react'
import { cn } from '@/lib/utils.js'

export interface Column<T> {
  key: string
  title: string
  dataIndex?: keyof T
  render?: (value: T[keyof T] | undefined, record: T, index: number) => React.ReactNode
  width?: string | number
  align?: 'left' | 'center' | 'right'
}

export interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: keyof T | ((record: T) => string)
  emptyText?: string
  isLoading?: boolean
  onRowClick?: (record: T) => void
  className?: string
}

export function Table<T>({
  columns,
  data,
  rowKey,
  emptyText = '暂无数据',
  isLoading = false,
  onRowClick,
  className,
}: TableProps<T>) {
  const getRowKey = (record: T): string => {
    if (typeof rowKey === 'function') {
      return rowKey(record)
    }
    return String(record[rowKey])
  }

  return (
    <div className={cn('relative w-full overflow-auto', className)}>
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'h-10 px-2 text-left align-middle font-medium text-muted-foreground',
                )}
                style={{
                  width: col.width,
                  textAlign: col.align || 'left',
                }}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {isLoading ? (
            <tr>
              <td
                colSpan={columns.length}
                className="p-4 text-center text-sm text-muted-foreground"
              >
                加载中...
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="p-4 text-center text-sm text-muted-foreground"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((record, index) => (
              <tr
                key={getRowKey(record)}
                onClick={() => onRowClick?.(record)}
                className={cn(
                  'border-b transition-colors hover:bg-muted/50',
                  onRowClick && 'cursor-pointer'
                )}
              >
                {columns.map((col) => {
                  const value = col.dataIndex ? record[col.dataIndex] : undefined
                  return (
                    <td
                      key={col.key}
                      className="p-2 align-middle"
                      style={{ textAlign: col.align || 'left' }}
                    >
                      {col.render
                        ? col.render(value, record, index)
                        : (value as React.ReactNode)}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
