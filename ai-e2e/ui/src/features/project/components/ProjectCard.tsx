import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/shared/components';
import { cn } from '@/lib/utils';
import { Project } from '@/types/project';
import { useDeleteProject } from '../store/projectApi';

interface ProjectCardProps {
  project: Project;
}

const statusLabelMap: Record<string, string> = {
  draft: '草稿',
  configuring: '配置中',
  analyzing: '分析中',
  analyzed: '已分析',
  exploring: '探索中',
  explored: '已探索',
  generating: '生成中',
  ready: '就绪',
  running: '运行中',
  completed: '已完成',
};

const statusStyleMap: Record<string, string> = {
  active: 'bg-status-success/20 text-status-success',
  running: 'bg-status-success/20 text-status-success',
  completed: 'bg-status-success/20 text-status-success',
  error: 'bg-status-error/20 text-status-error',
  analyzing: 'bg-status-info/20 text-status-info',
  exploring: 'bg-status-info/20 text-status-info',
  generating: 'bg-status-info/20 text-status-info',
  default: 'bg-surface-elevated text-text-secondary',
};

const getStatusStyle = (status: string): string => {
  return statusStyleMap[status] || statusStyleMap.default;
};

export const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  const navigate = useNavigate();
  const deleteMutation = useDeleteProject();

  const handleClick = () => {
    navigate(`/project/${project.id}`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`确定要删除项目 "${project.name}" 吗？`)) {
      deleteMutation.mutate(project.id);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <Card className="cursor-pointer border-border-default bg-surface-content p-4 transition-colors hover:border-border-hover" onClick={handleClick}>
      <div className="flex items-start justify-between">
        <h3 className="text-base font-medium" title={project.name}>{project.name}</h3>
        <span className={cn('rounded-full px-2 py-0.5 text-xs', getStatusStyle(project.status))}>
          {statusLabelMap[project.status] || project.status}
        </span>
      </div>
      
      <div className="mt-1 text-sm text-text-secondary">
        {project.description || '暂无描述'}
      </div>
      
      <div className="mt-3 flex items-center justify-end border-t border-border-default pt-3">
        <span className="text-text-secondary">创建于 {formatDate(project.created_at)}</span>
        <button 
          className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          onClick={handleDelete}
          title="删除项目"
        >
          删除
        </button>
      </div>
    </Card>
  );
};
