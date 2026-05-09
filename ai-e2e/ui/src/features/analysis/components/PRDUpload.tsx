import React, { useState, useRef } from 'react';
import { Button, Card } from '@/shared/components';
import styles from './PRDUpload.module.css';

export interface PRDUploadProps {
  content: string;
  onChange: (content: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

export const PRDUpload: React.FC<PRDUploadProps> = ({
  content,
  onChange,
  onAnalyze,
  isAnalyzing,
}) => {
  const [isPreview, setIsPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        onChange(text);
      }
    };
    reader.readAsText(file);
    
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>PRD 内容</div>
        <div className={styles.actions}>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsPreview(!isPreview)}
          >
            {isPreview ? '编辑' : '预览'}
          </Button>
          <div className={styles.uploadButton}>
            <Button variant="secondary" size="sm">
              上传文件
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              className={styles.fileInput}
              onChange={handleFileChange}
              title="上传 .txt 或 .md 文件"
            />
          </div>
        </div>
      </div>

      <div className={styles.textareaContainer}>
        {isPreview ? (
          <div className={styles.previewContainer}>
            {content || '暂无内容'}
          </div>
        ) : (
          <textarea
            className={styles.textarea}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            placeholder="在此粘贴 PRD 内容，或点击上方按钮上传文件..."
            disabled={isAnalyzing}
          />
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.charCount}>
          {content.length} 字符
        </div>
        <Button 
          variant="primary" 
          onClick={onAnalyze} 
          isLoading={isAnalyzing}
          disabled={!content.trim() || isAnalyzing}
        >
          开始分析
        </Button>
      </div>
    </Card>
  );
};
