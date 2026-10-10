export type SseFrameField = 'id' | 'event' | 'retry' | 'data';

export interface SseJsonFrameOptions {
  readonly event: string;
  readonly data: unknown;
  readonly id?: string;
  readonly retry?: number;
  readonly fieldOrder?: readonly SseFrameField[];
}

const DEFAULT_FRAME_ORDER: readonly SseFrameField[] = ['event', 'id', 'retry', 'data'];

export function encodeSseJsonFrame(input: SseJsonFrameOptions): string {
  const lines: string[] = [];
  for (const field of input.fieldOrder ?? DEFAULT_FRAME_ORDER) {
    switch (field) {
      case 'id':
        if (input.id !== undefined) lines.push(`id: ${input.id}`);
        break;
      case 'event':
        lines.push(`event: ${input.event}`);
        break;
      case 'retry':
        if (input.retry !== undefined) lines.push(`retry: ${input.retry}`);
        break;
      case 'data':
        lines.push(`data: ${JSON.stringify(input.data)}`);
        break;
      default:
        throw new Error(`Unsupported SSE frame field: ${field satisfies never}`);
    }
  }
  return `${lines.join('\n')}\n\n`;
}
