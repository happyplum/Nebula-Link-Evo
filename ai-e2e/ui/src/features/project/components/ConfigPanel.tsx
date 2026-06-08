import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Input } from '@/shared/components';
import { 
  useProjectConfig, 
  useUpdateProjectConfig, 
  useTransitionProjectState,
  useCreateLoginScript,
  useTestLoginScript,
  ProjectConfig,
  LoginStep
} from '../store/configApi';
import { useProject } from '../store/projectApi';

const STEP_TYPES: LoginStep['type'][] = ['navigate', 'fill', 'click', 'wait'];

const STEP_TYPE_LABELS: Record<LoginStep['type'], string> = {
  navigate: '导航',
  fill: '填写',
  click: '点击',
  wait: '等待',
  screenshot: '截图',
};

const DEFAULT_STEP: LoginStep = { type: 'navigate', description: '' };

export const ConfigPanel: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  
  const { data: project } = useProject(projectId);
  const { data: config, isLoading } = useProjectConfig(projectId);
  const updateMutation = useUpdateProjectConfig();
  const transitionMutation = useTransitionProjectState();

  const [localConfig, setLocalConfig] = useState<ProjectConfig>({
    base_url: '',
    auth_type: 'none',
    auth_config: {},
    seed_urls: [''],
  });

  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalConfig({
        base_url: config.base_url || '',
        auth_type: config.auth_type || 'none',
        auth_config: config.auth_config || {},
        seed_urls: config.seed_urls && config.seed_urls.length > 0 ? config.seed_urls : [''],
      });
    }
  }, [config]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-8">加载配置中...</div>;
  }

  const handleSave = async () => {
    const cleanedConfig = {
      ...localConfig,
      seed_urls: localConfig.seed_urls.filter(url => url.trim() !== '')
    };
    
    await updateMutation.mutateAsync({ 
      projectId, 
      config: cleanedConfig 
    });
  };

  const handleStartAnalysis = async () => {
    try {
      await handleSave();
      transitionMutation.mutate({ 
        projectId, 
        targetStatus: 'analyzing' 
      });
    } catch {
      // save 失败时全局 toast 已经由 queryClient defaultOptions 处理
    }
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

  const [loginSteps, setLoginSteps] = useState<LoginStep[]>([]);
  const [savedScriptId, setSavedScriptId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const createScriptMutation = useCreateLoginScript();
  const testScriptMutation = useTestLoginScript();

  const updateLoginStep = useCallback((index: number, patch: Partial<LoginStep>) => {
    setLoginSteps(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const addLoginStep = () => {
    setLoginSteps(prev => [...prev, { ...DEFAULT_STEP }]);
  };

  const removeLoginStep = (index: number) => {
    setLoginSteps(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveScript = async () => {
    if (!projectId) return;
    setTestResult(null);
    try {
      const saved = await createScriptMutation.mutateAsync({
        projectId,
        script: {
          name: 'login-script',
          description: '登录脚本',
          steps: loginSteps,
          is_reusable: true,
        },
      });
      setSavedScriptId(saved.id ?? null);
      setTestResult({ ok: true, message: '脚本已保存' });
    } catch {
      setTestResult({ ok: false, message: '保存失败' });
    }
  };

  const handleTestScript = async () => {
    if (!projectId || !savedScriptId) return;
    setTestResult(null);
    try {
      await testScriptMutation.mutateAsync({ projectId, scriptId: savedScriptId });
      setTestResult({ ok: true, message: '测试通过' });
    } catch {
      setTestResult({ ok: false, message: '测试失败' });
    }
  };

  const isConfiguring = project?.status === 'configuring' || project?.status === 'draft';

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-text-secondary">目标配置</h2>
        
        <div className="space-y-2">
          <Input
            label="目标基础 URL"
            value={localConfig.base_url}
            onChange={(e) => setLocalConfig({...localConfig, base_url: e.target.value})}
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
                checked={localConfig.auth_type === 'none'}
                onChange={() => setLocalConfig({
                  ...localConfig, 
                  auth_type: 'none',
                  auth_config: {},
                })}
              />
              无需登录
            </label>
            <label className="text-sm">
              <input
                type="radio"
                name="authType"
                value="login-script"
                checked={localConfig.auth_type === 'login-script'}
                onChange={() => setLocalConfig({
                  ...localConfig, 
                  auth_type: 'login-script',
                })}
              />
              使用登录脚本
            </label>
          </div>
        </div>

        {localConfig.auth_type === 'login-script' && (
          <div className="space-y-3 rounded-md bg-surface-content p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary">登录脚本编辑</span>
            </div>
            <div className="text-xs text-text-muted">
              手动添加登录步骤，保存后可测试回放。
            </div>

            {loginSteps.length === 0 && (
              <div className="py-2 text-xs text-text-muted text-center">暂无步骤，点击下方按钮添加</div>
            )}

            <div className="space-y-2">
              {loginSteps.map((step, index) => (
                <div key={index} className="flex flex-col gap-1.5 rounded-md bg-surface-elevated p-2">
                  <div className="flex items-center gap-2">
                    <select
                      className="h-7 rounded-md border border-border-default bg-transparent px-2 text-xs text-text-primary outline-none"
                      value={step.type}
                      onChange={e => updateLoginStep(index, { type: e.target.value as LoginStep['type'] })}
                    >
                      {STEP_TYPES.map(t => (
                        <option key={t} value={t}>{STEP_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                    <input
                      className="flex-1 h-7 rounded-md border border-border-default bg-transparent px-2 text-xs text-text-primary outline-none placeholder:text-text-muted"
                      value={step.description}
                      onChange={e => updateLoginStep(index, { description: e.target.value })}
                      placeholder="步骤描述"
                    />
                    <button
                      className="text-text-muted hover:text-text-primary transition-colors text-sm"
                      onClick={() => removeLoginStep(index)}
                      title="移除此步骤"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(step.type === 'navigate') && (
                      <input
                        className="flex-1 min-w-[120px] h-7 rounded-md border border-border-default bg-transparent px-2 text-xs text-text-primary outline-none placeholder:text-text-muted"
                        value={step.url ?? ''}
                        onChange={e => updateLoginStep(index, { url: e.target.value })}
                        placeholder="URL"
                      />
                    )}
                    {(step.type === 'fill' || step.type === 'click') && (
                      <input
                        className="flex-1 min-w-[100px] h-7 rounded-md border border-border-default bg-transparent px-2 text-xs text-text-primary outline-none placeholder:text-text-muted"
                        value={step.selector ?? ''}
                        onChange={e => updateLoginStep(index, { selector: e.target.value })}
                        placeholder="选择器"
                      />
                    )}
                    {step.type === 'fill' && (
                      <input
                        className="flex-1 min-w-[100px] h-7 rounded-md border border-border-default bg-transparent px-2 text-xs text-text-primary outline-none placeholder:text-text-muted"
                        value={step.value ?? ''}
                        onChange={e => updateLoginStep(index, { value: e.target.value })}
                        placeholder="填写值"
                      />
                    )}
                    {step.type === 'wait' && (
                      <input
                        type="number"
                        className="w-20 h-7 rounded-md border border-border-default bg-transparent px-2 text-xs text-text-primary outline-none placeholder:text-text-muted"
                        value={step.duration ?? ''}
                        onChange={e => updateLoginStep(index, { duration: Number(e.target.value) || undefined })}
                        placeholder="毫秒"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Button variant="ghost" size="sm" onClick={addLoginStep}>
              + 添加步骤
            </Button>

            {testResult && (
              <div className={`text-xs px-2 py-1 rounded ${testResult.ok ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                {testResult.message}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveScript}
                isLoading={createScriptMutation.isPending}
                disabled={loginSteps.length === 0}
              >
                保存脚本
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTestScript}
                isLoading={testScriptMutation.isPending}
                disabled={!savedScriptId}
              >
                测试脚本
              </Button>
            </div>
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
            disabled={!localConfig.base_url}
          >
            开始分析
          </Button>
        )}
      </div>
    </div>
  );
};
