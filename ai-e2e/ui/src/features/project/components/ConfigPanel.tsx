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
    return <div className="flex items-center justify-center py-8">加载配置中...</div>;
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
      targetStatus: 'analyzing' 
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
    <div className="flex flex-col gap-4">
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-text-secondary">目标配置</h2>
        
        <div className="space-y-2">
          <Input
            label="目标基础 URL"
            value={localConfig.target_base_url}
            onChange={(e) => setLocalConfig({...localConfig, target_base_url: e.target.value})}
            placeholder="https://example.com"
            fullWidth
          />
          <div className="text-xs text-text-muted">测试目标应用的基础地址</div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-text-secondary">认证配置</h2>
        
        <div className="space-y-2">
          <div className="flex gap-3">
            <label className="text-sm">
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
            <label className="text-sm">
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
          <div className="space-y-2 rounded-md bg-surface-content p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">登录脚本录制</span>
              <Button variant="secondary" size="sm">开始录制</Button>
            </div>
            <div className="text-xs text-text-muted">
              点击"开始录制"将在浏览器中打开目标页面，您可以手动执行登录操作，系统将自动记录步骤。
            </div>
            
            {/* Placeholder for recorded steps */}
            <div className="space-y-1">
              <div className="flex gap-2 text-sm">
                <span className="text-text-muted">navigate</span>
                <span className="text-text-secondary">打开登录页面</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-text-muted">fill</span>
                <span className="text-text-secondary">输入用户名</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-text-muted">fill</span>
                <span className="text-text-secondary">输入密码</span>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="text-text-muted">click</span>
                <span className="text-text-secondary">点击登录按钮</span>
              </div>
            </div>
            
            <Button variant="ghost" size="sm">测试登录脚本</Button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-text-secondary">种子页面 (可选)</h2>
        <div className="text-xs text-text-muted" style={{ marginBottom: '8px' }}>
          提供一些起始页面URL，帮助AI更好地探索应用。如果不提供，AI将从基础URL开始探索。
        </div>
        
        <div className="space-y-2">
          {localConfig.seed_urls.map((url, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  value={url}
                  onChange={(e) => updateSeedUrl(index, e.target.value)}
                  placeholder="/dashboard 或 https://example.com/dashboard"
                  fullWidth
                />
              </div>
              <button 
                className="text-text-muted hover:text-text-primary transition-colors"
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
        >
          + 添加种子页面
        </Button>
      </div>

      <div className="flex gap-2 justify-end border-t border-border-default pt-4">
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
