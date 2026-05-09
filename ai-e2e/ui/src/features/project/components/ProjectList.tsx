import React, { useState } from 'react';
import { Button } from '@/shared/components';
import { useProjects } from '../store/projectApi';
import { ProjectCard } from './ProjectCard';
import { CreateProjectDialog } from './CreateProjectDialog';
import styles from './ProjectList.module.css';

export const ProjectList: React.FC = () => {
  const { data: projects, isLoading, error } = useProjects();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (isLoading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  if (error) {
    return <div className={styles.loading}>加载失败: {(error as Error).message}</div>;
  }

  return (
    <div className={styles.listContainer}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>项目管理</h1>
          <p className={styles.description}>管理您的端到端自动化测试项目</p>
        </div>
        <Button variant="primary" onClick={() => setIsDialogOpen(true)}>
          新建项目
        </Button>
      </div>

      {!projects || projects.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>PRD</div>
          <div className={styles.emptyTitle}>暂无项目</div>
          <div className={styles.emptyDesc}>创建一个新项目开始您的自动化测试之旅</div>
          <Button variant="primary" onClick={() => setIsDialogOpen(true)}>
            新建项目
          </Button>
        </div>
      ) : (
        <div className={styles.grid}>
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
