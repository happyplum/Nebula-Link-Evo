import React, { useState, useRef } from 'react';
import { Button, Card } from '@/shared/components';

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
    <Card className="flex flex-col gap-4 flex-1">
      <div className="flex items-center justify-between">
        <div className="text-base font-medium">PRD 内容</div>
        <div className="flex gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsPreview(!isPreview)}
          >
            {isPreview ? '编辑' : '预览'}
          </Button>
          <div className="relative">
            <Button variant="secondary" size="sm">
              上传文件
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileChange}
              title="上传 .txt 或 .md 文件"
            />
          </div>
        </div>
      </div>

      <div>
        {isPreview ? (
          <div className="w-full min-h-[120px] bg-surface-content border border-border-default rounded-md p-3 whitespace-pre-wrap text-sm text-text-primary">
            {content || '暂无内容'}
          </div>
        ) : (
          <textarea
            className="w-full min-h-[120px] bg-surface-content border border-border-default rounded-md p-3 text-sm text-text-primary resize-y"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            placeholder="在此粘贴 PRD 内容，或点击上方按钮上传文件..."
            disabled={isAnalyzing}
          />
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <div className="text-xs text-text-muted text-right">
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
