import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectedElementCard } from '../SelectedElementCard.js';
import { useControlStore } from '../../store/control.store.js';
import { testIds } from '@/shared/testing/testids.js';

describe('SelectedElementCard', () => {
  beforeEach(() => {
    useControlStore.setState({
      selectedElement: null,
      consoleMessages: [],
      isExecutingAction: false,
      lastActionError: null,
      viewport: null,
    });
  });

  it('renders empty state when no element is selected', () => {
    render(<SelectedElementCard />);
    
    expect(screen.getByTestId(testIds.selectedElementCard)).toBeInTheDocument();
    expect(screen.getByText('No element selected')).toBeInTheDocument();
  });

  it('renders element details when selected', () => {
    useControlStore.setState({
      selectedElement: {
        tag: 'button',
        selector: 'button#submit',
        text: 'Submit Form',
        attributes: {
          id: 'submit',
          class: 'btn primary',
          disabled: 'false'
        }
      }
    });

    render(<SelectedElementCard />);
    
    expect(screen.getByText('button')).toBeInTheDocument();
    expect(screen.getByText('button#submit')).toBeInTheDocument();
    expect(screen.getByText('Submit Form')).toBeInTheDocument();
    
    // Check attributes
    expect(screen.getByText('id=')).toBeInTheDocument();
    expect(screen.getByText('"submit"')).toBeInTheDocument();
    expect(screen.getByText('class=')).toBeInTheDocument();
    expect(screen.getByText('"btn primary"')).toBeInTheDocument();
  });

  it('renders without text and attributes if not provided', () => {
    useControlStore.setState({
      selectedElement: {
        tag: 'div',
        selector: 'div.container',
      }
    });

    render(<SelectedElementCard />);
    
    expect(screen.getByText('div')).toBeInTheDocument();
    expect(screen.getByText('div.container')).toBeInTheDocument();
    expect(screen.queryByText('Text')).not.toBeInTheDocument();
    expect(screen.queryByText('Attributes')).not.toBeInTheDocument();
  });
});
