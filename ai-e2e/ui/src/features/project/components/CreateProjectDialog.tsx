import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal } from '@/shared/components';
import type { CreateProjectInput } from '@/types/project.js';
import { useCreateProject } from '../store/projectApi.js';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const INITIAL_FORM: CreateProjectInput = {
  name: '',
  description: '',
  versionKey: 'main',
  versionName: '主业务版本',
  targetOrigin: '',
  environment: 'test',
  prd: { format: 'markdown', content: '' },
  createdBy: 'local-user',
};

export function CreateProjectDialog({ isOpen, onClose }: CreateProjectDialogProps) {
  const [form, setForm] = useState<CreateProjectInput>(INITIAL_FORM);
  const createMutation = useCreateProject();
  const navigate = useNavigate();
  const canSubmit = Boolean(
    form.name.trim() && form.targetOrigin.trim() && form.prd.content.trim() && form.versionKey.trim()
  );

  const update = <K extends keyof CreateProjectInput>(key: K, value: CreateProjectInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    createMutation.mutate(form, {
      onSuccess: (workspace) => {
        setForm(INITIAL_FORM);
        onClose();
        const initialUrl = new URL('/', form.targetOrigin).toString();
        navigate(
          `/semantic/${workspace.id}/authoring/${workspace.versionId}?bootstrap=1&url=${encodeURIComponent(initialUrl)}`
        );
      },
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="创建 Semantic E2E 项目"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || createMutation.isPending}
            isLoading={createMutation.isPending}
          >
            创建并开始编排
          </Button>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="项目名称"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="例如：订单中心"
            fullWidth
            autoFocus
            required
          />
          <Input
            label="目标站点"
            value={form.targetOrigin}
            onChange={(event) => update('targetOrigin', event.target.value)}
            placeholder="https://test.example.com"
            type="url"
            fullWidth
            required
          />
          <Input
            label="业务版本键"
            value={form.versionKey}
            onChange={(event) => update('versionKey', event.target.value.toLowerCase())}
            placeholder="main"
            fullWidth
            required
          />
          <Input
            label="业务版本名称"
            value={form.versionName}
            onChange={(event) => update('versionName', event.target.value)}
            fullWidth
            required
          />
        </div>

        <label className="block space-y-1.5 text-sm text-text-secondary">
          <span>部署环境</span>
          <select
            className="min-h-10 w-full rounded-md border border-border-default bg-surface-content px-3 text-text-primary outline-none focus:border-status-info focus:ring-2 focus:ring-status-info/25"
            value={form.environment}
            onChange={(event) => update('environment', event.target.value as CreateProjectInput['environment'])}
          >
            <option value="local">本地</option>
            <option value="test">测试</option>
            <option value="staging">预发布</option>
            <option value="production">生产只读</option>
          </select>
        </label>

        <label className="block space-y-1.5 text-sm text-text-secondary">
          <span>PRD / 验收需求</span>
          <textarea
            className="min-h-40 w-full resize-y rounded-md border border-border-default bg-surface-content px-3 py-2 font-mono text-sm leading-6 text-text-primary outline-none focus:border-status-info focus:ring-2 focus:ring-status-info/25"
            value={form.prd.content}
            onChange={(event) => update('prd', { ...form.prd, content: event.target.value })}
            placeholder="粘贴 Markdown 或纯文本需求，包含功能点与验收标准…"
            required
          />
        </label>

        <Input
          label="项目说明（可选）"
          value={form.description ?? ''}
          onChange={(event) => update('description', event.target.value)}
          placeholder="说明测试边界、角色或环境约束"
          fullWidth
        />

        {createMutation.error && (
          <div role="alert" className="rounded-md border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
            {createMutation.error.message}
          </div>
        )}
      </form>
    </Modal>
  );
}
