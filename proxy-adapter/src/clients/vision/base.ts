import { UIElement } from '../../config/schema.js';

export interface VisionClient {
  provider: string;
  model: string;
  capabilities: string[];

  detect(
    screenshot: string,
    viewport: { width: number; height: number },
    options?: { instruction?: string }
  ): Promise<UIElement[]>;

  getCapabilities(): string[];
}
