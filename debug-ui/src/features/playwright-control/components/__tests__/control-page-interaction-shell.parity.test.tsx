import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { testIds } from '@/shared/testing/testids.js';
import { PageInteractionShell } from '../PageInteractionShell.js';

describe('PageInteractionShell Parity Test', () => {
  it('renders Accordion with correct testid and title', () => {
    render(<PageInteractionShell />);

    const accordion = screen.getByTestId(testIds.controlPageInteraction);
    expect(accordion).toBeInTheDocument();

    const header = screen.getByRole('button', { name: /页面交互/i });
    expect(header).toBeInTheDocument();
    expect(header).toHaveTextContent('页面交互');
  });

  it('renders element picker checkbox with correct testid and label', () => {
    render(<PageInteractionShell />);

    const picker = screen.getByTestId(testIds.controlPageInteractionElementPicker);
    expect(picker).toBeInTheDocument();
    expect(picker).toHaveAttribute('type', 'checkbox');
    expect(picker).toHaveAttribute('id', 'element-picker');
    expect(picker).toBeDisabled();

    const label = screen.getByText('元素选择模式');
    expect(label).toBeInTheDocument();
    expect(label.tagName.toLowerCase()).toBe('label');
  });

  it('renders element picker helper text', () => {
    render(<PageInteractionShell />);

    const helper = screen.getByText('开启后在实时画面上点击选择元素');
    expect(helper).toBeInTheDocument();
  });

  it('renders coordinate click section with X and Y inputs', () => {
    render(<PageInteractionShell />);

    const sectionLabel = screen.getByText('坐标点击');
    expect(sectionLabel).toBeInTheDocument();

    const coordX = screen.getByTestId(testIds.controlPageInteractionCoordX);
    expect(coordX).toBeInTheDocument();
    expect(coordX).toHaveAttribute('type', 'number');
    expect(coordX).toBeDisabled();

    const coordY = screen.getByTestId(testIds.controlPageInteractionCoordY);
    expect(coordY).toBeInTheDocument();
    expect(coordY).toHaveAttribute('type', 'number');
    expect(coordY).toBeDisabled();
  });

  it('renders coordinate click button with correct testid', () => {
    render(<PageInteractionShell />);

    const clickBtn = screen.getByTestId(testIds.controlPageInteractionCoordClick);
    expect(clickBtn).toBeInTheDocument();
    expect(clickBtn.tagName.toLowerCase()).toBe('button');
    expect(clickBtn).toHaveTextContent('点击');
    expect(clickBtn).toBeDisabled();
  });

  it('renders element operations section with selector mode select', () => {
    render(<PageInteractionShell />);

    const sectionLabel = screen.getByText('元素操作');
    expect(sectionLabel).toBeInTheDocument();

    const selectorMode = screen.getByTestId(testIds.controlPageInteractionSelectorMode);
    expect(selectorMode).toBeInTheDocument();
    expect(selectorMode.tagName.toLowerCase()).toBe('select');
    expect(selectorMode).toBeDisabled();

    const options = selectorMode.querySelectorAll('option');
    expect(options).toHaveLength(2);
    expect(options[0].value).toBe('marker');
    expect(options[0]).toHaveTextContent('Marker ID');
    expect(options[1].value).toBe('css');
    expect(options[1]).toHaveTextContent('CSS 选择器');
  });

  it('renders element operations section with marker ID input in default marker mode', () => {
    render(<PageInteractionShell />);

    // Default selectorMode is 'marker' — marker ID input is in DOM
    const markerId = screen.getByTestId(testIds.controlPageInteractionMarkerId);
    expect(markerId).toBeInTheDocument();
    expect(markerId).toHaveAttribute('type', 'number');
    expect(markerId).toHaveAttribute('placeholder', '元素序号 (#)');
    expect(markerId).toBeDisabled();

    // CSS selector input should NOT be in DOM in marker mode
    expect(screen.queryByTestId(testIds.controlPageInteractionCssSelector)).not.toBeInTheDocument();
  });

  it('switches to CSS selector input when selector mode is changed to css', () => {
    render(<PageInteractionShell />);

    // Switch to CSS mode
    const selectorMode = screen.getByTestId(testIds.controlPageInteractionSelectorMode);
    fireEvent.change(selectorMode, { target: { value: 'css' } });

    // CSS selector input should now be in DOM
    const cssSelector = screen.getByTestId(testIds.controlPageInteractionCssSelector);
    expect(cssSelector).toBeInTheDocument();
    expect(cssSelector).toHaveAttribute('type', 'text');
    expect(cssSelector).toHaveAttribute('placeholder', 'CSS 选择器');
    expect(cssSelector).toBeDisabled();

    // Marker ID input should NOT be in DOM in CSS mode
    expect(screen.queryByTestId(testIds.controlPageInteractionMarkerId)).not.toBeInTheDocument();
  });

  it('renders element operations section with action type select and shows param input only for actions that need it', () => {
    render(<PageInteractionShell />);

    const actionType = screen.getByTestId(testIds.controlPageInteractionActionType);
    expect(actionType).toBeInTheDocument();
    expect(actionType.tagName.toLowerCase()).toBe('select');
    expect(actionType).toBeDisabled();

    const options = actionType.querySelectorAll('option');
    expect(options).toHaveLength(7);
    expect(options[0].value).toBe('click');
    expect(options[0]).toHaveTextContent('点击');
    expect(options[1].value).toBe('type');
    expect(options[1]).toHaveTextContent('输入文本');
    expect(options[2].value).toBe('value');
    expect(options[2]).toHaveTextContent('设置值');
    expect(options[3].value).toBe('focus');
    expect(options[3]).toHaveTextContent('聚焦');
    expect(options[4].value).toBe('blur');
    expect(options[4]).toHaveTextContent('失焦');
    expect(options[5].value).toBe('hover');
    expect(options[5]).toHaveTextContent('悬停');
    expect(options[6].value).toBe('dispatch');
    expect(options[6]).toHaveTextContent('派发事件');

    expect(screen.queryByTestId(testIds.controlPageInteractionActionParam)).not.toBeInTheDocument();

    fireEvent.change(actionType, { target: { value: 'type' } });

    const actionParam = screen.getByTestId(testIds.controlPageInteractionActionParam);
    expect(actionParam).toBeInTheDocument();
    expect(actionParam).toHaveAttribute('type', 'text');
    expect(actionParam).toHaveAttribute('placeholder', '输入文本');
    expect(actionParam).toBeDisabled();
  });

  it('renders execute button with correct testid', () => {
    render(<PageInteractionShell />);

    const executeBtn = screen.getByTestId(testIds.controlPageInteractionExecute);
    expect(executeBtn).toBeInTheDocument();
    expect(executeBtn.tagName.toLowerCase()).toBe('button');
    expect(executeBtn).toHaveTextContent('执行');
    expect(executeBtn).toBeDisabled();
  });

  it('renders page scroll section with X and Y inputs', () => {
    render(<PageInteractionShell />);

    const sectionLabel = screen.getByText('页面滚动');
    expect(sectionLabel).toBeInTheDocument();

    const scrollX = screen.getByTestId(testIds.controlPageInteractionScrollX);
    expect(scrollX).toBeInTheDocument();
    expect(scrollX).toHaveAttribute('type', 'number');
    expect(scrollX).toBeDisabled();

    const scrollY = screen.getByTestId(testIds.controlPageInteractionScrollY);
    expect(scrollY).toBeInTheDocument();
    expect(scrollY).toHaveAttribute('type', 'number');
    expect(scrollY).toBeDisabled();
  });

  it('renders scroll button with correct testid', () => {
    render(<PageInteractionShell />);

    const scrollBtn = screen.getByTestId(testIds.controlPageInteractionScroll);
    expect(scrollBtn).toBeInTheDocument();
    expect(scrollBtn.tagName.toLowerCase()).toBe('button');
    expect(scrollBtn).toHaveTextContent('滚动');
    expect(scrollBtn).toBeDisabled();
  });

  it('renders all always-present testids correctly (12 testids in default marker mode)', () => {
    render(<PageInteractionShell />);

    const alwaysPresent = [
      testIds.controlPageInteraction,
      testIds.controlPageInteractionElementPicker,
      testIds.controlPageInteractionCoordX,
      testIds.controlPageInteractionCoordY,
      testIds.controlPageInteractionCoordClick,
      testIds.controlPageInteractionSelectorMode,
      testIds.controlPageInteractionMarkerId,
      testIds.controlPageInteractionActionType,
      testIds.controlPageInteractionExecute,
      testIds.controlPageInteractionScrollX,
      testIds.controlPageInteractionScrollY,
      testIds.controlPageInteractionScroll,
    ];

    alwaysPresent.forEach((testid) => {
      expect(screen.getByTestId(testid)).toBeInTheDocument();
    });
  });

  it('renders Accordion icon', () => {
    render(<PageInteractionShell />);

    const header = screen.getByRole('button', { name: /页面交互/i });
    const icon = header.querySelector('span');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveTextContent('🖱️');
  });
});
