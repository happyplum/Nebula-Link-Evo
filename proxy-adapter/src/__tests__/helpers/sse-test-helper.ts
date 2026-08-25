import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { createParser, type EventSourceMessage } from 'eventsource-parser';

export interface TestServer {
  app: FastifyInstance;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export interface SSEConsumerResult {
  events: EventSourceMessage[];
  rawChunks: Uint8Array[];
}

export async function startTestServer(
  registerRoutes: (app: FastifyInstance) => Promise<void>
): Promise<TestServer> {
  const app = Fastify({ logger: false });
  await registerRoutes(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  return {
    app,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await app.close();
    },
  };
}

export async function consumeSSE(
  url: string,
  options?: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<SSEConsumerResult> {
  const events: EventSourceMessage[] = [];
  const rawChunks: Uint8Array[] = [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const parser = createParser({
      onEvent: (event) => {
        events.push(event);
      },
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rawChunks.push(value);
      parser.feed(decoder.decode(value, { stream: true }));
    }

    parser.feed(decoder.decode()); // flush
  } finally {
    clearTimeout(timeout);
  }

  return { events, rawChunks };
}
