import React, { useMemo } from 'react';
import { Script } from '../store/scriptsApi';
import styles from './ScriptList.module.css';

interface ScriptListProps {
  scripts: Script[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface GroupedScripts {
  [businessModule: string]: {
    [functionalModule: string]: Script[];
  };
}

export const ScriptList: React.FC<ScriptListProps> = ({ scripts, selectedId, onSelect }) => {
  const groupedScripts = useMemo(() => {
    const groups: GroupedScripts = {};
    
    scripts.forEach(script => {
      const bName = script.business_module_name || '未分类业务模块';
      const fName = script.functional_module_name || '未分类功能模块';
      
      if (!groups[bName]) {
        groups[bName] = {};
      }
      if (!groups[bName][fName]) {
        groups[bName][fName] = [];
      }
      
      groups[bName][fName].push(script);
    });
    
    return groups;
  }, [scripts]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'var(--color-success)';
      case 'failed': return 'var(--color-error)';
      case 'draft': return 'var(--color-warning)';
      default: return 'var(--color-text-muted)';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready': return '就绪';
      case 'failed': return '失败';
      case 'draft': return '草稿';
      default: return '未知';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>脚本列表</h3>
        <span className={styles.count}>共 {scripts.length} 个</span>
      </div>
      
      <div className={styles.list}>
        {Object.entries(groupedScripts).map(([bName, fModules]) => (
          <div key={bName} className={styles.businessModule}>
            <div className={styles.businessHeader}>{bName}</div>
            
            {Object.entries(fModules).map(([fName, moduleScripts]) => (
              <div key={fName} className={styles.functionalModule}>
                <div className={styles.functionalHeader}>{fName}</div>
                
                <div className={styles.scripts}>
                  {moduleScripts.map(script => (
                    <div 
                      key={script.id}
                      className={`${styles.scriptItem} ${selectedId === script.id ? styles.selected : ''}`}
                      onClick={() => onSelect(script.id)}
                    >
                      <div className={styles.scriptMain}>
                        <span className={styles.scriptName}>{script.scenario_name}</span>
                        <span 
                          className={styles.statusDot} 
                          style={{ backgroundColor: getStatusColor(script.status) }}
                          title={getStatusText(script.status)}
                        />
                      </div>
                      <div className={styles.scriptMeta}>
                        <span className={styles.version}>v{script.version}</span>
                        <span className={styles.generatedBy}>
                          {script.generated_by === 'ai_generated' ? 'AI 生成' : 
                           script.generated_by === 'human_edited' ? '人工编辑' : 'AI 修复'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        
        {scripts.length === 0 && (
          <div className={styles.empty}>暂无脚本</div>
        )}
      </div>
    </div>
  );
};
