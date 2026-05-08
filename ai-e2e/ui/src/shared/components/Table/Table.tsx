import React from 'react';
import styles from './Table.module.css';

export interface Column<T> {
  key: string;
  title: string;
  dataIndex?: keyof T;
  render?: (value: any, record: T, index: number) => React.ReactNode;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: keyof T | ((record: T) => string);
  emptyText?: string;
  isLoading?: boolean;
  onRowClick?: (record: T) => void;
  className?: string;
}

export function Table<T>({
  columns,
  data,
  rowKey,
  emptyText = '暂无数据',
  isLoading = false,
  onRowClick,
  className = '',
}: TableProps<T>) {
  const getRowKey = (record: T): string => {
    if (typeof rowKey === 'function') {
      return rowKey(record);
    }
    return String(record[rowKey]);
  };

  return (
    <div className={[styles.tableContainer, className].filter(Boolean).join(' ')}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th 
                key={col.key} 
                style={{ 
                  width: col.width, 
                  textAlign: col.align || 'left' 
                }}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className={styles.loadingCell}>
                加载中...
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.emptyCell}>
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((record, index) => (
              <tr 
                key={getRowKey(record)} 
                onClick={() => onRowClick?.(record)}
                className={onRowClick ? styles.clickableRow : ''}
              >
                {columns.map((col) => {
                  const value = col.dataIndex ? record[col.dataIndex] : undefined;
                  return (
                    <td 
                      key={col.key}
                      style={{ textAlign: col.align || 'left' }}
                    >
                      {col.render ? col.render(value, record, index) : (value as React.ReactNode)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
