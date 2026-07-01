import React, { useState, useRef, useEffect } from 'react';
import { Send, X, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { useAgentStore } from '../store/agentStore.js';
import { AgentMessage } from './AgentMessage.js';

interface AgentChatProps {
  onSend: (prompt: string) => void;
  isRunning: boolean;
}

export const AgentChat: React.FC<AgentChatProps> = ({ onSend, isRunning }) => {
  const isOpen = useAgentStore((s) => s.isOpen);
  const setOpen = useAgentStore((s) => s.setOpen);
  const messages = useAgentStore((s) => s.messages);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-96 flex-col rounded-2xl border border-border-default bg-surface-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Bot size={18} /> AI 测试助手
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="关闭">
          <X size={16} />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto p-4"
        style={{ maxHeight: '24rem', minHeight: '16rem' }}
      >
        {messages.length === 0 && (
          <div className="text-sm text-text-muted">试试输入：帮我测试登录流程</div>
        )}
        {messages.map((m) => (
          <AgentMessage key={m.id} message={m} />
        ))}
        {isRunning && <div className="text-xs text-text-muted">助手正在处理...</div>}
      </div>

      <div className="border-t border-border-default p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || isRunning) return;
            onSend(input.trim());
            setInput('');
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入指令..."
            className="flex-1"
            disabled={isRunning}
          />
          <Button type="submit" size="icon" disabled={isRunning || !input.trim()} aria-label="发送">
            <Send size={16} />
          </Button>
        </form>
      </div>
    </div>
  );
};
