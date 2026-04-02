import type { FC } from 'react';
import { Accordion } from '@/shared/ui/Accordion.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './PageInteractionShell.module.css';

export const PageInteractionShell: FC = () => (
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
            disabled
            data-testid={testIds.controlPageInteractionElementPicker}
          />
          <label htmlFor="element-picker" className={styles.pickerLabel}>
            元素选择模式
          </label>
        </div>
        <p className={styles.pickerHelper}>开启后在实时画面上点击选择元素</p>
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
            disabled
            data-testid={testIds.controlPageInteractionCoordX}
          />
          <span className={styles.inlineLabel}>Y</span>
          <input
            type="number"
            className={styles.numberInput}
            disabled
            data-testid={testIds.controlPageInteractionCoordY}
          />
          <button
            type="button"
            className={styles.actionButton}
            disabled
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
          disabled
          data-testid={testIds.controlPageInteractionSelectorMode}
        >
          <option value="marker">Marker ID</option>
          <option value="css">CSS 选择器</option>
        </select>

        <div className={styles.fieldRow}>
          <input
            type="number"
            className={styles.textInput}
            placeholder="元素序号 (#)"
            disabled
            data-testid={testIds.controlPageInteractionMarkerId}
          />
          <input
            type="text"
            className={styles.textInput}
            placeholder="CSS 选择器"
            disabled
            data-testid={testIds.controlPageInteractionCssSelector}
          />
        </div>

        <select
          className={styles.selectInput}
          disabled
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
          disabled
          data-testid={testIds.controlPageInteractionActionParam}
        />

        <button
          type="button"
          className={styles.executeButton}
          disabled
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
            disabled
            data-testid={testIds.controlPageInteractionScrollX}
          />
          <span className={styles.inlineLabel}>Y</span>
          <input
            type="number"
            className={styles.numberInput}
            disabled
            data-testid={testIds.controlPageInteractionScrollY}
          />
          <button
            type="button"
            className={styles.actionButton}
            disabled
            data-testid={testIds.controlPageInteractionScroll}
          >
            滚动
          </button>
        </div>
      </div>
    </div>
  </Accordion>
);
