import React, { useState } from 'react';
import { useControlStore, selectSelectedElement, selectIsExecutingAction, selectLastActionError } from '../store/control.store.js';
import { executeAction, evaluateExpression, takeScreenshot } from '../api/control.adapters.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ControlPanel.module.css';

export const ControlPanel: React.FC = () => {
  const selectedElement = useControlStore(selectSelectedElement);
  const isExecutingAction = useControlStore(selectIsExecutingAction);
  const lastActionError = useControlStore(selectLastActionError);
  const setExecutingAction = useControlStore((s) => s.setExecutingAction);
  const setActionError = useControlStore((s) => s.setActionError);

  const [inputValue, setInputValue] = useState('');
  const [urlValue, setUrlValue] = useState('');

  const handleAction = async (action: string, args?: Record<string, unknown>) => {
    setExecutingAction(true);
    setActionError(null);
    try {
      const response = await executeAction(action, args);
      if (!response.success) {
        setActionError(response.error || 'Action failed');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setExecutingAction(false);
    }
  };

  const handleEvaluate = async () => {
    if (!inputValue) return;
    setExecutingAction(true);
    setActionError(null);
    try {
      const response = await evaluateExpression(inputValue);
      if (!response.success) {
        setActionError(response.error || 'Evaluation failed');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setExecutingAction(false);
    }
  };

  const handleScreenshot = async () => {
    setExecutingAction(true);
    setActionError(null);
    try {
      const response = await takeScreenshot(selectedElement?.selector);
      if (!response.success) {
        setActionError(response.error || 'Screenshot failed');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setExecutingAction(false);
    }
  };

  return (
    <div className={styles.container} data-testid={testIds.controlPanel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Control Panel</h3>
      </div>

      {lastActionError && (
        <div className={styles.error}>{lastActionError}</div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => handleAction('click', { selector: selectedElement?.selector })}
          disabled={isExecutingAction || !selectedElement}
          data-testid={`${testIds.actionButton}-click`}
        >
          Click
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => handleAction('hover', { selector: selectedElement?.selector })}
          disabled={isExecutingAction || !selectedElement}
          data-testid={`${testIds.actionButton}-hover`}
        >
          Hover
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => handleAction('scroll', { direction: 'down' })}
          disabled={isExecutingAction}
          data-testid={`${testIds.actionButton}-scroll-down`}
        >
          Scroll Down
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => handleAction('scroll', { direction: 'up' })}
          disabled={isExecutingAction}
          data-testid={`${testIds.actionButton}-scroll-up`}
        >
          Scroll Up
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={handleScreenshot}
          disabled={isExecutingAction}
          data-testid={`${testIds.actionButton}-screenshot`}
        >
          Screenshot
        </button>
      </div>

      <div className={styles.inputGroup}>
        <input
          type="text"
          className={styles.input}
          placeholder="Text to type..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isExecutingAction}
        />
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={() => handleAction('type', { selector: selectedElement?.selector, text: inputValue })}
          disabled={isExecutingAction || !selectedElement || !inputValue}
          data-testid={`${testIds.actionButton}-type`}
        >
          Type
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={handleEvaluate}
          disabled={isExecutingAction || !inputValue}
          data-testid={`${testIds.actionButton}-evaluate`}
        >
          Eval
        </button>
      </div>

      <div className={styles.inputGroup}>
        <input
          type="text"
          className={styles.input}
          placeholder="URL to navigate..."
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          disabled={isExecutingAction}
        />
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={() => handleAction('navigate', { url: urlValue })}
          disabled={isExecutingAction || !urlValue}
          data-testid={`${testIds.actionButton}-navigate`}
        >
          Navigate
        </button>
      </div>
    </div>
  );
};
