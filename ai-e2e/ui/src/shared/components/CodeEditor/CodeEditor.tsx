import React, { forwardRef } from 'react';
import styles from './CodeEditor.module.css';

export interface CodeEditorProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  language?: string;
  label?: string;
  error?: string;
}

export const CodeEditor = forwardRef<HTMLTextAreaElement, CodeEditorProps>(
  ({ language = 'json', label, error, className = '', id, ...props }, ref) => {
    const editorId = id || `editor-${Math.random().toString(36).substr(2, 9)}`;
    
    const containerClass = [
      styles.container,
      className
    ].filter(Boolean).join(' ');

    const textareaClass = [
      styles.textarea,
      error ? styles.hasError : ''
    ].filter(Boolean).join(' ');

    return (
      <div className={containerClass}>
        {label && (
          <div className={styles.header}>
            <label htmlFor={editorId} className={styles.label}>
              {label}
            </label>
            <span className={styles.languageBadge}>{language}</span>
          </div>
        )}
        <div className={styles.editorWrapper}>
          <textarea
            ref={ref}
            id={editorId}
            className={textareaClass}
            spellCheck={false}
            {...props}
          />
        </div>
        {error && <span className={styles.errorMessage}>{error}</span>}
      </div>
    );
  }
);

CodeEditor.displayName = 'CodeEditor';
