import { ResolvedConfig } from '../../config/schema.js';
import { VisionClient } from './base.js';
import { GLMVisionClient, GLMConfig } from './glm.js';
import { OpenAIVisionClient, OpenAIVisionConfig } from './openai.js';
import { AnthropicVisionClient, AnthropicVisionConfig } from './anthropic.js';
import { NVIDIAPluginClient, NVIDIAPluginConfig } from './nvidia.js';

export interface VisionClientFactory {
  create(config: ResolvedConfig, provider: string, model: string): VisionClient | null;
  createDefault(config: ResolvedConfig): VisionClient | null;
  getAvailableProviders(config: ResolvedConfig): string[];
  getAvailableModels(config: ResolvedConfig, provider: string): string[];
}

export class VisionClientFactoryImpl implements VisionClientFactory {
  create(config: ResolvedConfig, provider: string, model: string): VisionClient | null {
    const providerConfig = config._resolved?.providers?.[provider];
    if (!providerConfig) {
      console.warn(`[VisionClient] Provider '${provider}' not found in resolved config`);
      return null;
    }

    const modelConfig = providerConfig.models[model];
    if (!modelConfig) {
      console.warn(`[VisionClient] Model '${model}' not found in provider '${provider}'`);
      return null;
    }

    switch (provider) {
      case 'glm':
        return this.createGLM(providerConfig, model);
      case 'openai':
        return this.createOpenAI(providerConfig, model);
      case 'anthropic':
        return this.createAnthropic(providerConfig, model);
      case 'nvidia':
        return this.createNVIDIA(providerConfig, model);
      default:
        console.warn(`Unknown vision provider: ${provider}`);
        return null;
    }
  }

  createDefault(config: ResolvedConfig): VisionClient | null {
    if (config.defaults.mode !== 'separation') {
      return null;
    }

    const { provider, model } = config.defaults.vision;
    return this.create(config, provider, model);
  }

  getAvailableProviders(config: ResolvedConfig): string[] {
    const providers: string[] = [];

    for (const [name, provider] of Object.entries(config.providers)) {
      if (!provider.enabled) continue;

      for (const model of Object.values(provider.models)) {
        if (model.capabilities.includes('vision')) {
          if (!providers.includes(name)) {
            providers.push(name);
          }
          break;
        }
      }
    }

    return providers;
  }

  getAvailableModels(config: ResolvedConfig, provider: string): string[] {
    const providerConfig = config.providers[provider];
    if (!providerConfig || !providerConfig.enabled) {
      return [];
    }

    return Object.entries(providerConfig.models)
      .filter(([_, model]) => model.capabilities.includes('vision'))
      .map(([name]) => name);
  }

  private createGLM(providerConfig: any, model: string): GLMVisionClient {
    const modelConfig = providerConfig.models[model];
    const config: GLMConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new GLMVisionClient(config);
  }

  private createOpenAI(providerConfig: any, model: string): OpenAIVisionClient {
    const modelConfig = providerConfig.models[model];
    const config: OpenAIVisionConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new OpenAIVisionClient(config);
  }

  private createAnthropic(providerConfig: any, model: string): AnthropicVisionClient {
    const modelConfig = providerConfig.models[model];
    const config: AnthropicVisionConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new AnthropicVisionClient(config);
  }

  private createNVIDIA(providerConfig: any, model: string): NVIDIAPluginClient {
    const modelConfig = providerConfig.models[model];
    const config: NVIDIAPluginConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new NVIDIAPluginClient(config);
  }
}

export function createVisionClientFactory(): VisionClientFactory {
  return new VisionClientFactoryImpl();
}
