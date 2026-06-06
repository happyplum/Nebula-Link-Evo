/**
 * Adapter barrel — re-exports from vercel-ai and mcp-server adapters.
 */
export {
  gatewayToolToVercelTool,
  gatewayToolsToVercelToolMap,
} from './vercel-ai.js';

export { registerGatewayToolsToMcpServer } from './mcp-server.js';
