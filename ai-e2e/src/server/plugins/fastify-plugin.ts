import type { FastifyPluginAsync, FastifyPluginCallback, FastifyPluginOptions } from 'fastify';

interface FastifyPluginMetadata {
  fastify?: string;
  name?: string;
  dependencies?: string[];
  decorators?: {
    fastify?: string[];
    reply?: string[];
    request?: string[];
  };
  encapsulate?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPluginFunction = ((...args: any[]) => any);

type SupportedFastifyPlugin<Options extends FastifyPluginOptions = FastifyPluginOptions> =
  | FastifyPluginAsync<Options>
  | FastifyPluginCallback<Options>
  | AnyPluginFunction;

let pluginCount = 0;

function getPluginName<Options extends FastifyPluginOptions>(plugin: SupportedFastifyPlugin<Options>): string {
  return (plugin as Function).name || 'anonymous-plugin';
}

export default function fp<Options extends FastifyPluginOptions = FastifyPluginOptions>(
  plugin: SupportedFastifyPlugin<Options>,
  metadata: FastifyPluginMetadata = {}
): SupportedFastifyPlugin<Options> {
  const pluginMetadata = { ...metadata };

  if (!pluginMetadata.name) {
    pluginMetadata.name = `${getPluginName(plugin)}-auto-${pluginCount++}`;
  }

  Object.assign(plugin, {
    default: plugin,
    [Symbol.for('skip-override')]: pluginMetadata.encapsulate !== true,
    [Symbol.for('fastify.display-name')]: pluginMetadata.name,
    [Symbol.for('plugin-meta')]: pluginMetadata,
  });

  return plugin;
}
