import React, { useState } from 'react';
import styles from './Tree.module.css';

export interface TreeNodeData {
  key: string;
  title: React.ReactNode;
  children?: TreeNodeData[];
  isLeaf?: boolean;
  icon?: React.ReactNode;
}

export interface TreeProps {
  data: TreeNodeData[];
  selectedKeys?: string[];
  expandedKeys?: string[];
  onSelect?: (selectedKeys: string[], node: TreeNodeData) => void;
  onExpand?: (expandedKeys: string[], node: TreeNodeData, expanded: boolean) => void;
  className?: string;
}

const TreeNode: React.FC<{
  node: TreeNodeData;
  level: number;
  selectedKeys: string[];
  expandedKeys: string[];
  onSelect: (node: TreeNodeData) => void;
  onToggle: (node: TreeNodeData) => void;
}> = ({ node, level, selectedKeys, expandedKeys, onSelect, onToggle }) => {
  const isExpanded = expandedKeys.includes(node.key);
  const isSelected = selectedKeys.includes(node.key);
  const hasChildren = node.children && node.children.length > 0;
  const isLeaf = node.isLeaf || !hasChildren;

  return (
    <div className={styles.nodeContainer}>
      <div 
        className={[
          styles.nodeContent, 
          isSelected ? styles.selected : ''
        ].filter(Boolean).join(' ')}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        <span 
          className={[
            styles.switcher, 
            isLeaf ? styles.switcherLeaf : '',
            isExpanded ? styles.switcherExpanded : ''
          ].filter(Boolean).join(' ')}
          onClick={(e) => {
            e.stopPropagation();
            if (!isLeaf) onToggle(node);
          }}
        >
          {!isLeaf && '▶'}
        </span>
        {node.icon && <span className={styles.icon}>{node.icon}</span>}
        <span className={styles.title}>{node.title}</span>
      </div>
      
      {isExpanded && hasChildren && (
        <div className={styles.children}>
          {node.children!.map(child => (
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
  );
};

export const Tree: React.FC<TreeProps> = ({
  data,
  selectedKeys: propSelectedKeys,
  expandedKeys: propExpandedKeys,
  onSelect,
  onExpand,
  className = ''
}) => {
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<string[]>([]);
  const [internalExpandedKeys, setInternalExpandedKeys] = useState<string[]>([]);

  const selectedKeys = propSelectedKeys !== undefined ? propSelectedKeys : internalSelectedKeys;
  const expandedKeys = propExpandedKeys !== undefined ? propExpandedKeys : internalExpandedKeys;

  const handleSelect = (node: TreeNodeData) => {
    const newSelectedKeys = [node.key];
    if (propSelectedKeys === undefined) {
      setInternalSelectedKeys(newSelectedKeys);
    }
    onSelect?.(newSelectedKeys, node);
  };

  const handleToggle = (node: TreeNodeData) => {
    const isExpanded = expandedKeys.includes(node.key);
    const newExpandedKeys = isExpanded
      ? expandedKeys.filter(k => k !== node.key)
      : [...expandedKeys, node.key];
      
    if (propExpandedKeys === undefined) {
      setInternalExpandedKeys(newExpandedKeys);
    }
    onExpand?.(newExpandedKeys, node, !isExpanded);
  };

  return (
    <div className={[styles.tree, className].filter(Boolean).join(' ')}>
      {data.map(node => (
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
  );
};
