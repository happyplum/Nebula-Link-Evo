import React from 'react';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import type { AgentMessage as AgentMessageType } from '../types/agent.js';

interface AgentMessageProps {
  message: AgentMessageType;
}

export const AgentMessage: React.FC<AgentMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] space-y-2 rounded-2xl px-4 py-3 text-sm',
          isUser ? 'bg-status-info text-white' : 'bg-surface-elevated text-text-primary',
        )}
      >
        <div>{message.content}</div>
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {message.actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant={action.variant === 'primary' ? 'default' : 'outline'}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
