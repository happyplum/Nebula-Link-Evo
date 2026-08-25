import React, { useState } from 'react'
import { cn } from '@/lib/utils.js'

export interface TreeNodeData {
  key: string
  title: React.ReactNode
  children?: TreeNodeData[]
  isLeaf?: boolean
  icon?: React.ReactNode
}

export interface TreeProps {
  data: TreeNodeData[]
  selectedKeys?: string[]
  expandedKeys?: string[]
  onSelect?: (selectedKeys: string[], node: TreeNodeData) => void
  onExpand?: (expandedKeys: string[], node: TreeNodeData, expanded: boolean) => void
  className?: string
}

const TreeNode: React.FC<{
  node: TreeNodeData
  level: number
  selectedKeys: string[]
  expandedKeys: string[]
  onSelect: (node: TreeNodeData) => void
  onToggle: (node: TreeNodeData) => void
}> = ({ node, level, selectedKeys, expandedKeys, onSelect, onToggle }) => {
  const isExpanded = expandedKeys.includes(node.key)
  const isSelected = selectedKeys.includes(node.key)
  const children = node.children ?? []
  const hasChildren = children.length > 0
  const isLeaf = node.isLeaf || !hasChildren

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded-sm py-1 pr-2 text-sm cursor-pointer transition-colors hover:bg-accent/50',
          isSelected && 'bg-accent text-accent-foreground'
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        <span
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground transition-transform',
            !isLeaf && 'cursor-pointer hover:text-foreground',
            isExpanded && 'rotate-90'
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (!isLeaf) onToggle(node)
          }}
        >
          {!isLeaf && '▶'}
        </span>
        {node.icon && (
          <span className="inline-flex shrink-0 text-muted-foreground">
            {node.icon}
          </span>
        )}
        <span className="truncate">{node.title}</span>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.key}
              node={child}
              level={level + 1}
              selectedKeys={selectedKeys}
              expandedKeys={expandedKeys}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const Tree: React.FC<TreeProps> = ({
  data,
  selectedKeys: propSelectedKeys,
  expandedKeys: propExpandedKeys,
  onSelect,
  onExpand,
  className,
}) => {
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<string[]>([])
  const [internalExpandedKeys, setInternalExpandedKeys] = useState<string[]>([])

  const selectedKeys =
    propSelectedKeys !== undefined ? propSelectedKeys : internalSelectedKeys
  const expandedKeys =
    propExpandedKeys !== undefined ? propExpandedKeys : internalExpandedKeys

  const handleSelect = (node: TreeNodeData) => {
    const newSelectedKeys = [node.key]
    if (propSelectedKeys === undefined) {
      setInternalSelectedKeys(newSelectedKeys)
    }
    onSelect?.(newSelectedKeys, node)
  }

  const handleToggle = (node: TreeNodeData) => {
    const isExp = expandedKeys.includes(node.key)
    const newExpandedKeys = isExp
      ? expandedKeys.filter((k) => k !== node.key)
      : [...expandedKeys, node.key]

    if (propExpandedKeys === undefined) {
      setInternalExpandedKeys(newExpandedKeys)
    }
    onExpand?.(newExpandedKeys, node, !isExp)
  }

  return (
    <div className={cn('text-sm', className)}>
      {data.map((node) => (
        <TreeNode
          key={node.key}
          node={node}
          level={0}
          selectedKeys={selectedKeys}
          expandedKeys={expandedKeys}
          onSelect={handleSelect}
          onToggle={handleToggle}
        />
      ))}
    </div>
  )
}
