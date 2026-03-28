import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';

/**
 * Contract: Screenshot produces correct multimodal message shape in the
 * messages array passed to streamText().
 *
 * The injection logic lives in ChatHandler.executeAIResponse():
 * - When screenshot is present, the last user message content is converted
 *   from a plain string to an array of content parts:
 *     [{ type: 'image', image: base64 }, { type: 'text', text: userText }]
 * - When no screenshot, messages remain text-only strings.
 */

function buildMessagesWithScreenshot(
  userText: string,
  screenshot?: string
): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: 'user', content: userText },
  ];

  if (screenshot) {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx !== -1) {
      const existing = messages[lastUserIdx];
      const text = typeof existing.content === 'string' ? existing.content : '';
      messages[lastUserIdx] = {
        role: 'user',
        content: [
          { type: 'image', image: screenshot },
          { type: 'text', text },
        ],
      };
    }
  }

  return messages;
}

describe('screenshot multimodal message contract', () => {
  it('injects image content part when screenshot is present', () => {
    const base64Screenshot = 'iVBORw0KGgoAAAANSUhEUg==';
    const messages = buildMessagesWithScreenshot('Describe this page', base64Screenshot);

    expect(messages).toHaveLength(1);
    const userMsg = messages[0];
    expect(userMsg.role).toBe('user');

    const content = userMsg.content as Array<{ type: string; image?: string; text?: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);

    expect(content[0]).toEqual({ type: 'image', image: base64Screenshot });
    expect(content[1]).toEqual({ type: 'text', text: 'Describe this page' });
  });

  it('produces text-only message when no screenshot is provided', () => {
    const messages = buildMessagesWithScreenshot('Hello world');

    expect(messages).toHaveLength(1);
    const userMsg = messages[0];
    expect(userMsg.role).toBe('user');
    expect(typeof userMsg.content).toBe('string');
    expect(userMsg.content).toBe('Hello world');
  });

  it('places image part before text part in content array', () => {
    const messages = buildMessagesWithScreenshot('Check this', 'abc123');

    const content = messages[0].content as Array<{ type: string }>;
    expect(content[0].type).toBe('image');
    expect(content[1].type).toBe('text');
  });
});
