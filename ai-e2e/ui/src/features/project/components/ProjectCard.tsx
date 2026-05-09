import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/shared/components';
import { Project } from '@/types/project';
import { useDeleteProject } from '../store/projectApi';
import styles from './ProjectCard.module.css';

interface ProjectCardProps {
  project: Project;
}

const statusMap: Record<string, string> = {
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
    <Card className={styles.card} onClick={handleClick}>
      <div className={styles.header}>
        <h3 className={styles.title} title={project.name}>{project.name}</h3>
        <span className={`${styles.statusBadge} ${styles[`status-${project.status}`]}`}>
          {statusMap[project.status] || project.status}
        </span>
      </div>
      
      <div className={styles.description}>
        {project.description || '暂无描述'}
      </div>
      
      <div className={styles.footer}>
        <span>创建于 {formatDate(project.created_at)}</span>
        <button 
          className={styles.deleteBtn} 
          onClick={handleDelete}
          title="删除项目"
        >
          删除
        </button>
      </div>
    </Card>
  );
};
