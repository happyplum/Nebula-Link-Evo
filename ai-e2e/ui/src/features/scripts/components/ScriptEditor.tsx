import React, { useState, useEffect, useRef } from 'react';
import { CodeEditor, Button } from '@/shared/components';
import { Script, useUpdateScript } from '../store/scriptsApi';
import styles from './ScriptEditor.module.css';

interface ScriptEditorProps {
  projectId: string;
  script: Script;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({ projectId, script }) => {
  const [content, setContent] = useState(script.content);
  const [isDirty, setIsDirty] = useState(false);
  const { mutate: updateScript, isPending } = useUpdateScript(projectId);
  const saveTimeoutRef = useRef<number | null>(null);

  // Reset content when script changes
  useEffect(() => {
    setContent(script.content);
    setIsDirty(false);
  }, [script.id, script.content]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setIsDirty(newContent !== script.content);

    // Auto-save after 2 seconds of inactivity
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      if (newContent !== script.content) {
        handleSave(newContent);
      }
    }, 2000);
  };

  const handleSave = (contentToSave: string = content) => {
    updateScript(
      { scriptId: script.id, data: { content: contentToSave } },
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
          {isPending ? (
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
          disabled={!isDirty || isPending}
        >
          保存
        </Button>
      </div>
      
      <div className={styles.editorContainer}>
        <CodeEditor
          value={content}
          onChange={handleContentChange}
          language="typescript"
          className={styles.editor}
        />
      </div>
    </div>
  );
};
