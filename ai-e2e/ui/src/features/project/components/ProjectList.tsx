import React, { useState } from 'react';
import { Button } from '@/shared/components';
import { useProjects } from '../store/projectApi';
import { ProjectCard } from './ProjectCard';
import { CreateProjectDialog } from './CreateProjectDialog';

export const ProjectList: React.FC = () => {
  const { data: projects, isLoading, error } = useProjects();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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
          <h1 className="text-lg font-semibold">项目管理</h1>
          <p className="text-sm text-text-secondary">管理您的端到端自动化测试项目</p>
        </div>
        <Button variant="primary" onClick={() => setIsDialogOpen(true)}>
          新建项目
        </Button>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-lg font-medium">暂无项目</div>
          <div className="text-sm text-text-muted">创建一个新项目开始您的自动化测试之旅</div>
          <Button variant="primary" onClick={() => setIsDialogOpen(true)}>
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

      <CreateProjectDialog 
        isOpen={isDialogOpen} 
        onClose={() => setIsDialogOpen(false)} 
      />
    </div>
  );
};
