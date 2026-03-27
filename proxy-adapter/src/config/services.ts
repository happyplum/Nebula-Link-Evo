export interface ServiceEndpoints {
  playwright: {
    host: string;
    port: number;
    url: string;
  };
}
function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value) {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}
export function getServiceEndpoints(): ServiceEndpoints {
  const playwrightHost = getEnvString('PLAYWRIGHT_HOST', 'localhost');
  const playwrightPort = getEnvNumber('PLAYWRIGHT_PORT', 3001);
  return {
    playwright: {
      host: playwrightHost,
      port: playwrightPort,
      url: `http://${playwrightHost}:${playwrightPort}`,
    },
  };
}
let cachedEndpoints: ServiceEndpoints | null = null;
export function getServiceEndpointsCached(): ServiceEndpoints {
  if (!cachedEndpoints) {
    cachedEndpoints = getServiceEndpoints();
  }
  return cachedEndpoints;
}
