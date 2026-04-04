import { useState, useCallback, type FC } from 'react';
import { Accordion } from '@/shared/ui/Accordion.js';
import { testIds } from '@/shared/testing/testids.js';
import { useControlStore } from '../store/control.store.js';
import { executeAction } from '../api/control.adapters.js';
import styles from './PageInteractionShell.module.css';

type SelectorMode = 'marker' | 'css';

export const PageInteractionShell: FC = () => {
  const browserOpen = useControlStore((s) => s.browserOpen);
  const isExecutingAction = useControlStore((s) => s.isExecutingAction);
  const setExecutingAction = useControlStore((s) => s.setExecutingAction);
  const setActionError = useControlStore((s) => s.setActionError);

  // Element picker — synced to store for LiveViewCanvas
  const elementPickerEnabled = useControlStore((s) => s.elementPickerEnabled);
  const setElementPickerEnabled = useControlStore((s) => s.setElementPickerEnabled);

  // Coordinate click
  const [coordX, setCoordX] = useState('');
  const [coordY, setCoordY] = useState('');

  // Element operations
  const [selectorMode, setSelectorMode] = useState<SelectorMode>('marker');
  const [markerId, setMarkerId] = useState('');
  const [cssSelector, setCssSelector] = useState('');
  const [actionType, setActionType] = useState('click');
  const [actionParam, setActionParam] = useState('');

  // Page scroll
  const [scrollX, setScrollX] = useState('');
  const [scrollY, setScrollY] = useState('');

  const disabled = !browserOpen || isExecutingAction;

  const handleCoordClick = useCallback(async () => {
    const x = Number(coordX);
    const y = Number(coordY);
    if (isNaN(x) || isNaN(y)) return;
    setExecutingAction(true);
    setActionError(null);
    try {
      const res = await executeAction('click', { x, y });
      if (!res.success) setActionError(res.error ?? '坐标点击失败');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '坐标点击异常');
    } finally {
      setExecutingAction(false);
    }
  }, [coordX, coordY, setExecutingAction, setActionError]);

  const handleElementAction = useCallback(async () => {
    const args: Record<string, unknown> = { param: actionParam };
    if (selectorMode === 'marker') {
      args.markerId = Number(markerId);
    } else {
      args.cssSelector = cssSelector;
    }
    setExecutingAction(true);
    setActionError(null);
    try {
      const res = await executeAction(actionType, args);
      if (!res.success) setActionError(res.error ?? '元素操作失败');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '元素操作异常');
    } finally {
      setExecutingAction(false);
    }
  }, [actionType, actionParam, selectorMode, markerId, cssSelector, setExecutingAction, setActionError]);

  const handleScroll = useCallback(async () => {
    const x = Number(scrollX);
    const y = Number(scrollY);
    if (isNaN(x) || isNaN(y)) return;
    setExecutingAction(true);
    setActionError(null);
    try {
      const res = await executeAction('scroll', { x, y });
      if (!res.success) setActionError(res.error ?? '页面滚动失败');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '页面滚动异常');
    } finally {
      setExecutingAction(false);
    }
  }, [scrollX, scrollY, setExecutingAction, setActionError]);

  return (
    <Accordion
      open={false}
      onToggle={() => {}}
      title="页面交互"
      icon="🖱️"
      testId={testIds.controlPageInteraction}
    >
      <div className={styles.section}>
        {/* Element Picker Mode */}
        <div className={styles.sectionGroup}>
          <div className={styles.pickerRow}>
            <input
              type="checkbox"
              id="element-picker"
              className={styles.pickerCheckbox}
              checked={elementPickerEnabled}
              onChange={(e) => setElementPickerEnabled(e.target.checked)}
              disabled={disabled}
              data-testid={testIds.controlPageInteractionElementPicker}
            />
            <label htmlFor="element-picker" className={styles.pickerLabel}>
              元素选择模式
            </label>
          </div>
          <p className={styles.pickerHelper}>
            {elementPickerEnabled
              ? '点击实时画面选择元素'
              : '开启后在实时画面上点击选择元素'}
          </p>
        </div>

        <hr className={styles.separator} />

        {/* Coordinate Click */}
        <div className={styles.sectionGroup}>
          <span className={styles.sectionLabel}>坐标点击</span>
          <div className={styles.inputRow}>
            <span className={styles.inlineLabel}>X</span>
            <input
              type="number"
              className={styles.numberInput}
              value={coordX}
              onChange={(e) => setCoordX(e.target.value)}
              disabled={disabled}
              data-testid={testIds.controlPageInteractionCoordX}
            />
            <span className={styles.inlineLabel}>Y</span>
            <input
              type="number"
              className={styles.numberInput}
              value={coordY}
              onChange={(e) => setCoordY(e.target.value)}
              disabled={disabled}
              data-testid={testIds.controlPageInteractionCoordY}
            />
            <button
              type="button"
              className={styles.actionButton}
              disabled={disabled}
              onClick={handleCoordClick}
              data-testid={testIds.controlPageInteractionCoordClick}
            >
              点击
            </button>
          </div>
        </div>

        <hr className={styles.separator} />

        {/* Element Operations */}
        <div className={styles.sectionGroup}>
          <span className={styles.sectionLabel}>元素操作</span>

          <select
            className={styles.selectInput}
            value={selectorMode}
            onChange={(e) => setSelectorMode(e.target.value as SelectorMode)}
            disabled={disabled}
            data-testid={testIds.controlPageInteractionSelectorMode}
          >
            <option value="marker">Marker ID</option>
            <option value="css">CSS 选择器</option>
          </select>

          <div className={styles.fieldRow}>
            {selectorMode === 'marker' ? (
              <input
                type="number"
                className={styles.textInput}
                placeholder="元素序号 (#)"
                value={markerId}
                onChange={(e) => setMarkerId(e.target.value)}
                disabled={disabled}
                data-testid={testIds.controlPageInteractionMarkerId}
              />
            ) : (
              <input
                type="text"
                className={styles.textInput}
                placeholder="CSS 选择器"
                value={cssSelector}
                onChange={(e) => setCssSelector(e.target.value)}
                disabled={disabled}
                data-testid={testIds.controlPageInteractionCssSelector}
              />
            )}
          </div>

          <select
            className={styles.selectInput}
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            disabled={disabled}
            data-testid={testIds.controlPageInteractionActionType}
          >
            <option value="click">点击</option>
            <option value="type">输入文本</option>
            <option value="value">设置值</option>
            <option value="focus">聚焦</option>
            <option value="blur">失焦</option>
            <option value="hover">悬停</option>
            <option value="dispatch">派发事件</option>
          </select>

          <input
            type="text"
            className={styles.textInput}
            placeholder="输入文本"
            value={actionParam}
            onChange={(e) => setActionParam(e.target.value)}
            disabled={disabled}
            data-testid={testIds.controlPageInteractionActionParam}
          />

          <button
            type="button"
            className={styles.executeButton}
            disabled={disabled}
            onClick={handleElementAction}
            data-testid={testIds.controlPageInteractionExecute}
          >
            执行
          </button>
        </div>

        <hr className={styles.separator} />

        {/* Page Scroll */}
        <div className={styles.sectionGroup}>
          <span className={styles.sectionLabel}>页面滚动</span>
          <div className={styles.inputRow}>
            <span className={styles.inlineLabel}>X</span>
            <input
              type="number"
              className={styles.numberInput}
              value={scrollX}
              onChange={(e) => setScrollX(e.target.value)}
              disabled={disabled}
              data-testid={testIds.controlPageInteractionScrollX}
            />
            <span className={styles.inlineLabel}>Y</span>
            <input
              type="number"
              className={styles.numberInput}
              value={scrollY}
              onChange={(e) => setScrollY(e.target.value)}
              disabled={disabled}
              data-testid={testIds.controlPageInteractionScrollY}
            />
            <button
              type="button"
              className={styles.actionButton}
              disabled={disabled}
              onClick={handleScroll}
              data-testid={testIds.controlPageInteractionScroll}
            >
              滚动
            </button>
          </div>
        </div>
      </div>
    </Accordion>
  );
};
