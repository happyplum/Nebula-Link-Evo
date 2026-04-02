import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChatMessageAreaShell } from '../components/ChatMessageAreaShell';
import { ChatComposerShell } from '../components/ChatComposerShell';
import { testIds } from '@/shared/testing/testids';

describe('P2-13: AI Message and Composer Shell Parity Tests', () => {
  describe('ChatMessageAreaShell', () => {
    it('renders message area container with correct testid', () => {
      render(<ChatMessageAreaShell />);

      const messageArea = screen.getByTestId(testIds.chatMessageArea);
      expect(messageArea).toBeInTheDocument();
    });

    it('renders empty state with correct testid and text', () => {
      render(<ChatMessageAreaShell />);

      const emptyState = screen.getByTestId(testIds.chatMessageAreaEmpty);
      expect(emptyState).toBeInTheDocument();
      expect(emptyState).toHaveTextContent('选择或创建会话以开始');
    });
  });

  describe('ChatComposerShell', () => {
    it('renders composer container with correct testid', () => {
      render(<ChatComposerShell />);

      const composer = screen.getByTestId(testIds.chatComposer);
      expect(composer).toBeInTheDocument();
    });

    it('renders model selector with correct testid and options', () => {
      render(<ChatComposerShell />);

      const modelSelect = screen.getByTestId(testIds.chatComposerModelSelect);
      expect(modelSelect).toBeInTheDocument();
      expect(modelSelect).toHaveValue('decision');

      const options = modelSelect.querySelectorAll('option');
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveValue('decision');
      expect(options[0]).toHaveTextContent('决策模型');
      expect(options[1]).toHaveValue('vision');
      expect(options[1]).toHaveTextContent('视觉模型');
    });

    it('renders textarea with correct testid', () => {
      render(<ChatComposerShell />);

      const textarea = screen.getByTestId(testIds.chatComposerTextarea);
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveAttribute('placeholder', '输入消息... (Ctrl+Enter 发送)');
      expect(textarea).toHaveAttribute('rows', '3');
    });

    it('renders screenshot button with correct testid', () => {
      render(<ChatComposerShell />);

      const screenshotBtn = screen.getByTestId(testIds.chatComposerScreenshotBtn);
      expect(screenshotBtn).toBeInTheDocument();
      expect(screenshotBtn).toHaveAttribute('type', 'button');
      expect(screenshotBtn).toHaveAttribute('title', '附加截图');
      expect(screenshotBtn).toHaveTextContent('📷');
    });

    it('renders send button with correct testid', () => {
      render(<ChatComposerShell />);

      const sendBtn = screen.getByTestId(testIds.chatComposerSendBtn);
      expect(sendBtn).toBeInTheDocument();
      expect(sendBtn).toHaveAttribute('type', 'button');
      expect(sendBtn).toHaveAttribute('title', '发送');
      expect(sendBtn).toHaveTextContent('➤');
    });
  });
});
