import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Tabs } from '../Tabs.js';
import { testIds } from '../../testing/testids.js';

describe('Tabs', () => {
  const tabs = [
    { id: 'tab1', label: 'Tab 1' },
    { id: 'tab2', label: 'Tab 2' },
    { id: 'tab3', label: 'Tab 3' },
  ];

  it('renders all tabs', () => {
    render(
      <Tabs tabs={tabs} activeTab="tab1" onTabChange={() => {}}>
        <div>Tab Content</div>
      </Tabs>
    );
    
    expect(screen.getByTestId(`${testIds.tabsPrefix}tab1`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.tabsPrefix}tab2`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.tabsPrefix}tab3`)).toBeInTheDocument();
    expect(screen.getByText('Tab Content')).toBeInTheDocument();
  });

  it('calls onTabChange when a tab is clicked', () => {
    const onTabChange = vi.fn();
    render(
      <Tabs tabs={tabs} activeTab="tab1" onTabChange={onTabChange}>
        <div>Tab Content</div>
      </Tabs>
    );
    
    fireEvent.click(screen.getByTestId(`${testIds.tabsPrefix}tab2`));
    expect(onTabChange).toHaveBeenCalledWith('tab2');
  });

  it('handles keyboard navigation', () => {
    const onTabChange = vi.fn();
    render(
      <Tabs tabs={tabs} activeTab="tab1" onTabChange={onTabChange}>
        <div>Tab Content</div>
      </Tabs>
    );
    
    const tab1 = screen.getByTestId(`${testIds.tabsPrefix}tab1`);
    
    fireEvent.keyDown(tab1, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('tab2');
    
    fireEvent.keyDown(tab1, { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('tab3');
  });
});
