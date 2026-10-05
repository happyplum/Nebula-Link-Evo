export interface SseFrame {
  readonly eventName: string;
  readonly data: string;
}

export interface SseTransport {
  close(): void;
}

export interface SseTransportOptions {
  readonly endpoint: string;
  readonly eventNames: readonly string[];
  readonly handlers: {
    readonly onFrame: (frame: SseFrame) => void;
    readonly onError: () => void;
  };
}

export type SseTransportFactory = (options: SseTransportOptions) => SseTransport;

export const createEventSourceTransport: SseTransportFactory = ({
  endpoint,
  eventNames,
  handlers,
}) => {
  const source = new EventSource(endpoint);
  for (const eventName of eventNames) {
    source.addEventListener(eventName, (event: MessageEvent<string>) => {
      handlers.onFrame({ eventName, data: event.data });
    });
  }
  source.onerror = () => handlers.onError();
  return { close: () => source.close() };
};

export const createFetchSseTransport: SseTransportFactory = (options) => {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const readStream = async () => {
    const response = await fetch(options.endpoint, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    if (!response.ok) throw new Error(`SSE request failed with HTTP ${response.status}`);
    if (!response.body) throw new Error('SSE response has no body');

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) {
        options.handlers.onError();
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = dispatchCompleteBlocks(buffer, options);
    }
  };

  void readStream().catch((error: unknown) => {
    if (controller.signal.aborted) return;
    if (!(error instanceof Error)) throw error;
    options.handlers.onError();
  });

  return {
    close: () => {
      controller.abort();
      void reader?.cancel();
    },
  };
};

function dispatchCompleteBlocks(buffer: string, options: SseTransportOptions): string {
  let remaining = buffer;
  while (true) {
    const separator = /\r?\n\r?\n/u.exec(remaining);
    if (!separator || separator.index === undefined) return remaining;
    const block = remaining.slice(0, separator.index);
    remaining = remaining.slice(separator.index + separator[0].length);
    dispatchBlock(block, options);
  }
}

function dispatchBlock(block: string, options: SseTransportOptions): void {
  let eventName = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length > 0) options.handlers.onFrame({ eventName, data: data.join('\n') });
}
