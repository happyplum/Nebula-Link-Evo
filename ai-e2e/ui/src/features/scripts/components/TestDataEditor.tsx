import React, { useState, useEffect, useRef } from 'react';
import { CodeEditor, Button } from '@/shared/components';
import { Script, useUpdateScript } from '../store/scriptsApi';
import styles from './TestDataEditor.module.css';

interface TestDataEditorProps {
  projectId: string;
  script: Script;
}

export const TestDataEditor: React.FC<TestDataEditorProps> = ({ projectId, script }) => {
  const [content, setContent] = useState(script.test_data_json || '{\n  \n}');
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutate: updateScript, isPending } = useUpdateScript(projectId);
  const saveTimeoutRef = useRef<number | null>(null);

  // Reset content when script changes
  useEffect(() => {
    setContent(script.test_data_json || '{\n  \n}');
    setIsDirty(false);
    setError(null);
  }, [script.id, script.test_data_json]);

  const validateJson = (jsonString: string): boolean => {
    try {
      JSON.parse(jsonString);
      setError(null);
      return true;
    } catch (e) {
      setError('无效的 JSON 格式');
      return false;
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setIsDirty(newContent !== (script.test_data_json || '{\n  \n}'));
    
    validateJson(newContent);

    // Auto-save after 2 seconds of inactivity if valid
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      if (newContent !== script.test_data_json && validateJson(newContent)) {
        handleSave(newContent);
      }
    }, 2000);
  };

  const handleSave = (contentToSave: string = content) => {
    if (!validateJson(contentToSave)) return;
    
    updateScript(
      { scriptId: script.id, data: { test_data_json: contentToSave } },
      {
        onSuccess: () => {
          setIsDirty(false);
        }
      }
    );
  };

  const handleManualSave = () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    handleSave();
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.status}>
          {error ? (
            <span className={styles.error}>{error}</span>
          ) : isPending ? (
            <span className={styles.saving}>保存中...</span>
          ) : isDirty ? (
            <span className={styles.unsaved}>未保存更改</span>
          ) : (
            <span className={styles.saved}>已保存</span>
          )}
        </div>
        <Button 
          variant="primary" 
          size="sm" 
          onClick={handleManualSave}
          disabled={!isDirty || isPending || !!error}
        >
          保存
        </Button>
      </div>
      
      <div className={styles.editorContainer}>
        <CodeEditor
          value={content}
          onChange={handleContentChange}
          language="json"
          className={styles.editor}
          error={error || undefined}
        />
      </div>
    </div>
  );
};
