import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble.js';
import { testIds } from '@/shared/testing/testids.js';
import type { ChatMessage } from '../../types/index.js';

describe('MessageBubble', () => {
  it('renders user message correctly', () => {
    const message: ChatMessage = {
      id: '1',
      role: 'user',
      content: 'Hello assistant',
    };

    render(<MessageBubble message={message} />);
    
    const bubble = screen.getByTestId(testIds.messageBubble);
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-role', 'user');
    expect(screen.getByText('Hello assistant')).toBeInTheDocument();
  });

  it('renders assistant message correctly', () => {
    const message: ChatMessage = {
      id: '2',
      role: 'assistant',
      content: 'Hello user',
    };

    render(<MessageBubble message={message} />);
    
    const bubble = screen.getByTestId(testIds.messageBubble);
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-role', 'assistant');
    expect(screen.getByText('Hello user')).toBeInTheDocument();
  });

  it('renders thinking block if present', () => {
    const message: ChatMessage = {
      id: '3',
      role: 'assistant',
      content: 'Final answer',
      thinking: 'Thinking process...',
    };

    render(<MessageBubble message={message} />);
    
    expect(screen.getByTestId(testIds.thinkingBlock)).toBeInTheDocument();
    expect(screen.getByText('Final answer')).toBeInTheDocument();
  });

  it('does not render tool calls (handled by ToolCallCard)', () => {
    const message: ChatMessage = {
      id: '4',
      role: 'assistant',
      content: 'Using tool',
      toolCalls: [
        { id: 't1', name: 'get_weather', arguments: '{}', status: 'completed' }
      ]
    };

    render(<MessageBubble message={message} />);
    
    // Tool calls are rendered by ToolCallCard in MessageList, not in MessageBubble
    expect(screen.getByText('Using tool')).toBeInTheDocument();
    expect(screen.queryByText('get_weather')).not.toBeInTheDocument();
  });
});
