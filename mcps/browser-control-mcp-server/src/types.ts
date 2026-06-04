import type { PlaywrightClient } from './playwright-client.js';
import type { Config } from './config.js';

export interface ToolDeps {
  playwrightClient: PlaywrightClient;
}

export interface ToolContext {
  deps: ToolDeps;
  config: Config;
}
