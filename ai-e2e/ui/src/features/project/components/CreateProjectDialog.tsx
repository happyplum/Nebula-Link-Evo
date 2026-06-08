import React, { useState } from 'react';
import { Modal, Input, Button } from '@/shared/components';
import { useCreateProject } from '../store/projectApi';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMutation = useCreateProject();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    createMutation.mutate(
      { name, description },
      {
        onSuccess: () => {
          setName('');
          setDescription('');
          onClose();
        },
      }
    );
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>取消</Button>
      <Button 
        variant="primary" 
        onClick={handleSubmit} 
        disabled={!name.trim() || createMutation.isPending}
        isLoading={createMutation.isPending}
      >
        创建
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="新建项目"
      footer={footer}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          label="项目名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入项目名称"
          fullWidth
          autoFocus
          required
        />
        <Input
          label="项目描述 (可选)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="输入项目描述"
          fullWidth
        />
      </form>
    </Modal>
  );
};
