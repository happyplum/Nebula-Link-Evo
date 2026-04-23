import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import WebSocket from 'ws';
import { BrowserService } from '../../services/browser-service.js';
import { WebSocket as FastifyWebSocket } from '@fastify/websocket';

const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get('/cdp', { websocket: true }, async (connection: FastifyWebSocket, req) => {
    req.log.info('CDP WebSocket connection request');
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
          req.log.info({ cdpEndpoint }, 'Connecting to browser CDP');
          try {
            browserWs = new WebSocket(cdpEndpoint);
            browserWs.on('open', () => {
              req.log.info('Connected to browser CDP');
              // Flush buffered messages
              if (messageBuffer.length > 0) {
                req.log.info({ count: messageBuffer.length }, 'Flushing buffered messages');
                for (const msg of messageBuffer) {
                  browserWs?.send(msg);
                }
                messageBuffer = [];
              }
            });
            browserWs.on('message', (data: WebSocket.RawData) => {
              const preview = (() => {
                if (data instanceof ArrayBuffer) {
                  return Buffer.from(data).subarray(0, 100).toString('utf8');
                }
                if (Array.isArray(data)) {
                  return Buffer.concat(data).subarray(0, 100).toString('utf8');
                }
                return data.subarray(0, 100).toString('utf8');
              })();
              req.log.debug({ preview: preview || '<binary>' }, 'CDP message from browser');
              if (!isClosed && connection.readyState === 1) {
                connection.send(data);
              } else {
                req.log.warn('Cannot forward to client: closed or not ready');
              }
            });
          } catch {
            // Connection error handled by WebSocket events
          }
        } else {
          // No CDP endpoint available
        }
      }
    }, 100);

    connection.on('message', (data: Buffer) => {
      if (browserWs && browserWs.readyState === 1) {
        browserWs.send(data);
      } else {
        req.log.debug('Buffering message: browserWs not ready');
        messageBuffer.push(data);
      }
    });
    connection.on('close', () => {
      req.log.info('Client WebSocket closed');
      isClosed = true;
      clearInterval(checkInterval);
      if (browserWs) {
        browserWs.close();
        browserWs = null;
      }
    });
    connection.on('error', (error: Error) => {
      req.log.error({ err: error }, 'Client WebSocket error');
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
