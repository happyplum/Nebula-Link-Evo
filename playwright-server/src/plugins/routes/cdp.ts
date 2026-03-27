import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import WebSocket from 'ws';
import { BrowserService } from '../../services/browser-service.js';
import { WebSocket as FastifyWebSocket } from '@fastify/websocket';

const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get('/cdp', { websocket: true }, async (connection: FastifyWebSocket, _req) => {
    console.log('[CDP] New WebSocket connection request');
    let browserWs: WebSocket | null = null;
    let isClosed = false;
    let messageBuffer: Buffer[] = [];
    const checkInterval = setInterval(async () => {
      if (isClosed) {
        clearInterval(checkInterval);
        return;
      }
      if (BrowserService.getInstance().isOpen()) {
        clearInterval(checkInterval);
        const cdpEndpoint = await BrowserService.getInstance().getCdpEndpoint();
        if (cdpEndpoint) {
          console.log(`[CDP] Connecting to browser CDP: ${cdpEndpoint}`);
          try {
            browserWs = new WebSocket(cdpEndpoint);
            browserWs.on('open', () => {
              console.log('[CDP] Connected to browser CDP');
              // Flush buffered messages
              if (messageBuffer.length > 0) {
                console.log(`[CDP] Flushing ${messageBuffer.length} buffered messages`);
                for (const msg of messageBuffer) {
                  browserWs?.send(msg);
                }
                messageBuffer = [];
              }
            });
            browserWs.on('message', (data: WebSocket.RawData) => {
              // ... existing code ...
              const preview = (() => {
                if (data instanceof ArrayBuffer) {
                  return Buffer.from(data).subarray(0, 100).toString('utf8');
                }
                if (Array.isArray(data)) {
                  return Buffer.concat(data).subarray(0, 100).toString('utf8');
                }
                return data.subarray(0, 100).toString('utf8');
              })();
              console.log('[CDP] Received message from browser:', preview || '<binary>');
              if (!isClosed && connection.readyState === 1) {
                // console.log('[CDP] Forwarding to client');
                connection.send(data);
              } else {
                console.log('[CDP] Cannot forward to client: closed or not ready');
              }
            });
            // ... existing code ...
          } catch {
            // ... existing code ...
          }
        } else {
          // ... existing code ...
        }
      }
    }, 100); // Check more frequently

    connection.on('message', (data: Buffer) => {
      // console.log('[CDP] Received message from client:', data.slice(0, 100));
      if (browserWs && browserWs.readyState === 1) {
        // console.log('[CDP] Forwarding to browser');
        browserWs.send(data);
      } else {
        console.log('[CDP] Buffering message: browserWs not ready');
        messageBuffer.push(data);
      }
    });
    connection.on('close', () => {
      console.log('[CDP] Client WebSocket closed');
      isClosed = true;
      clearInterval(checkInterval);
      if (browserWs) {
        browserWs.close();
        browserWs = null;
      }
    });
    connection.on('error', (error: Error) => {
      console.error('[CDP] Client WebSocket error:', error.message);
      isClosed = true;
      clearInterval(checkInterval);
      if (browserWs) {
        browserWs.close();
        browserWs = null;
      }
    });
  });
  fastify.get(
    '/cdp-status',
    {
      schema: {
        description: 'Get CDP connection status',
        tags: ['CDP'],
        summary: 'Get CDP status',
      },
    },
    async () => {
      const isOpen = BrowserService.getInstance().isOpen();
      const cdpEndpoint = isOpen ? await BrowserService.getInstance().getCdpEndpoint() : null;
      const cdpPort = BrowserService.getInstance().getCdpPort();
      return {
        browserOpen: isOpen,
        cdpPort,
        cdpEndpoint: cdpEndpoint || 'Not available',
        ready: isOpen && cdpEndpoint !== null,
      };
    }
  );
};

export default routes;
