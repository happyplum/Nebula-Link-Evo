import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Input } from '@/shared/components';
import { 
  useProjectConfig, 
  useUpdateProjectConfig, 
  useTransitionProjectState,
  ProjectConfig
} from '../store/configApi';
import { useProject } from '../store/projectApi';
import styles from './ConfigPanel.module.css';

export const ConfigPanel: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  
  const { data: project } = useProject(projectId);
  const { data: config, isLoading } = useProjectConfig(projectId);
  const updateMutation = useUpdateProjectConfig();
  const transitionMutation = useTransitionProjectState();

  const [localConfig, setLocalConfig] = useState<ProjectConfig>({
    target_base_url: '',
    auth_config: { type: 'none' },
    seed_urls: [''],
  });

  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalConfig({
        target_base_url: config.target_base_url || '',
        auth_config: config.auth_config || { type: 'none' },
        seed_urls: config.seed_urls && config.seed_urls.length > 0 ? config.seed_urls : [''],
      });
    }
  }, [config]);

  if (isLoading) {
    return <div className={styles.loading}>加载配置中...</div>;
  }

  const handleSave = () => {
    // Filter out empty seed URLs
    const cleanedConfig = {
      ...localConfig,
      seed_urls: localConfig.seed_urls.filter(url => url.trim() !== '')
    };
    
    updateMutation.mutate({ 
      projectId, 
      config: cleanedConfig 
    });
  };

  const handleStartAnalysis = () => {
    handleSave();
    transitionMutation.mutate({ 
      projectId, 
      state: 'analyzing' 
    });
  };

  const addSeedUrl = () => {
    setLocalConfig({
      ...localConfig,
      seed_urls: [...localConfig.seed_urls, '']
    });
  };

  const updateSeedUrl = (index: number, value: string) => {
    const newUrls = [...localConfig.seed_urls];
    newUrls[index] = value;
    setLocalConfig({
      ...localConfig,
      seed_urls: newUrls
    });
  };

  const removeSeedUrl = (index: number) => {
    const newUrls = localConfig.seed_urls.filter((_, i) => i !== index);
    if (newUrls.length === 0) newUrls.push('');
    setLocalConfig({
      ...localConfig,
      seed_urls: newUrls
    });
  };

  const isConfiguring = project?.status === 'configuring' || project?.status === 'draft';

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>目标配置</h2>
        
        <div className={styles.formGroup}>
          <Input
            label="目标基础 URL"
            value={localConfig.target_base_url}
            onChange={(e) => setLocalConfig({...localConfig, target_base_url: e.target.value})}
            placeholder="https://example.com"
            fullWidth
          />
          <div className={styles.helpText}>测试目标应用的基础地址</div>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>认证配置</h2>
        
        <div className={styles.formGroup}>
          <div className={styles.radioGroup}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="authType"
                value="none"
                checked={localConfig.auth_config.type === 'none'}
                onChange={() => setLocalConfig({
                  ...localConfig, 
                  auth_config: { type: 'none' }
                })}
              />
              无需登录
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="authType"
                value="login-script"
                checked={localConfig.auth_config.type === 'login-script'}
                onChange={() => setLocalConfig({
                  ...localConfig, 
                  auth_config: { type: 'login-script' }
                })}
              />
              使用登录脚本
            </label>
          </div>
        </div>

        {localConfig.auth_config.type === 'login-script' && (
          <div className={styles.loginScriptArea}>
            <div className={styles.scriptHeader}>
              <span className={styles.scriptTitle}>登录脚本录制</span>
              <Button variant="secondary" size="sm">开始录制</Button>
            </div>
            <div className={styles.helpText}>
              点击"开始录制"将在浏览器中打开目标页面，您可以手动执行登录操作，系统将自动记录步骤。
            </div>
            
            {/* Placeholder for recorded steps */}
            <div className={styles.scriptSteps}>
              <div className={styles.scriptStep}>
                <span className={styles.stepType}>navigate</span>
                <span className={styles.stepDesc}>打开登录页面</span>
              </div>
              <div className={styles.scriptStep}>
                <span className={styles.stepType}>fill</span>
                <span className={styles.stepDesc}>输入用户名</span>
              </div>
              <div className={styles.scriptStep}>
                <span className={styles.stepType}>fill</span>
                <span className={styles.stepDesc}>输入密码</span>
              </div>
              <div className={styles.scriptStep}>
                <span className={styles.stepType}>click</span>
                <span className={styles.stepDesc}>点击登录按钮</span>
              </div>
            </div>
            
            <Button variant="ghost" size="sm">测试登录脚本</Button>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>种子页面 (可选)</h2>
        <div className={styles.helpText} style={{ marginBottom: '8px' }}>
          提供一些起始页面URL，帮助AI更好地探索应用。如果不提供，AI将从基础URL开始探索。
        </div>
        
        <div className={styles.seedUrlList}>
          {localConfig.seed_urls.map((url, index) => (
            <div key={index} className={styles.seedUrlItem}>
              <div className={styles.seedUrlInput}>
                <Input
                  value={url}
                  onChange={(e) => updateSeedUrl(index, e.target.value)}
                  placeholder="/dashboard 或 https://example.com/dashboard"
                  fullWidth
                />
              </div>
              <button 
                className={styles.removeBtn} 
                onClick={() => removeSeedUrl(index)}
                title="移除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={addSeedUrl}
          className={styles.addBtn}
        >
          + 添加种子页面
        </Button>
      </div>

      <div className={styles.actions}>
        <Button 
          variant="secondary" 
          onClick={handleSave}
          isLoading={updateMutation.isPending}
        >
          保存配置
        </Button>
        
        {isConfiguring && (
          <Button 
            variant="primary" 
            onClick={handleStartAnalysis}
            isLoading={transitionMutation.isPending}
            disabled={!localConfig.target_base_url}
          >
            开始分析
          </Button>
        )}
      </div>
    </div>
  );
};
