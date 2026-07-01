import React, { useState } from 'react';
import { Button } from '@/shared/components';
import { useProjects } from '../store/projectApi.js';
import { ProjectCard } from './ProjectCard.js';
import { CreateProjectDialog } from './CreateProjectDialog.js';

interface ProjectListProps {
  /** 当由外部仪表盘控制时，主 CTA 与空状态按钮会调用此回调而非打开内部对话框 */
  onCreateProject?: () => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({ onCreateProject }) => {
  const { data: projects, isLoading, error } = useProjects();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleCreateClick = () => {
    if (onCreateProject) {
      onCreateProject();
    } else {
      setIsDialogOpen(true);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-8">加载中...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center py-8">加载失败: {(error as Error).message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">项目管理</h2>
          <p className="text-sm text-text-secondary">管理您的端到端自动化测试项目</p>
        </div>
        <Button variant="primary" onClick={handleCreateClick}>
          新建项目
        </Button>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-lg font-medium text-text-primary">暂无项目</div>
          <div className="text-sm text-text-muted">创建一个新项目开始您的自动化测试之旅</div>
          <Button variant="primary" onClick={handleCreateClick}>
            新建项目
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {!onCreateProject && (
        <CreateProjectDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
      )}
    </div>
  );
};
