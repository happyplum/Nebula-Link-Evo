import { ResolvedConfig } from '../../config/schema.js';
import { DecisionClient } from '../types.js';
import { KimiDecisionClient, KimiDecisionConfig } from './kimi.js';
import { NVIDIADecisionClient, NVIDIADecisionConfig } from './nvidia.js';
import { GLMDecisionClient, GLMDecisionConfig } from './glm.js';

export interface DecisionClientFactory {
  create(config: ResolvedConfig, provider: string, model: string): DecisionClient | null;
  createDefault(config: ResolvedConfig): DecisionClient | null;
  getAvailableProviders(config: ResolvedConfig): string[];
  getAvailableModels(config: ResolvedConfig, provider: string): string[];
}

export class DecisionClientFactoryImpl implements DecisionClientFactory {
  create(config: ResolvedConfig, provider: string, model: string): DecisionClient | null {
    const providerConfig = config._resolved?.providers?.[provider];
    if (!providerConfig) {
      const availableProviders = Object.keys(config._resolved?.providers || {}).join(', ');
      console.warn(
        `[DecisionClient] Provider '${provider}' not found or disabled. Available: ${availableProviders || 'none'}`
      );
      return null;
    }

    const modelConfig = providerConfig.models[model];
    if (!modelConfig) {
      const availableModels = Object.keys(providerConfig.models).join(', ');
      console.warn(
        `[DecisionClient] Model '${model}' not found in provider '${provider}'. Available: ${availableModels || 'none'}`
      );
      return null;
    }

    switch (provider) {
      case 'kimi':
        return this.createKimi(providerConfig, model);
      case 'nvidia':
        return this.createNVIDIA(providerConfig, model);
      case 'glm':
        return this.createGLM(providerConfig, model);
      case 'openai':
        return this.createOpenAI(providerConfig, model);
      case 'anthropic':
        return this.createAnthropic(providerConfig, model);
      default:
        console.warn(`Unknown decision provider: ${provider}`);
        return null;
    }
  }

  createDefault(config: ResolvedConfig): DecisionClient | null {
    const { provider, model } = config.defaults.decision;
    return this.create(config, provider, model);
  }

  getAvailableProviders(config: ResolvedConfig): string[] {
    const providers: string[] = [];

    for (const [name, provider] of Object.entries(config._resolved?.providers || {})) {
      for (const model of Object.values(provider.models)) {
        if (model.capabilities.includes('decision')) {
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
    const providerConfig = config._resolved?.providers?.[provider];
    if (!providerConfig) {
      return [];
    }

    return Object.entries(providerConfig.models)
      .filter(([_, model]) => model.capabilities.includes('decision'))
      .map(([name]) => name);
  }

  private createKimi(providerConfig: any, model: string): KimiDecisionClient {
    const modelConfig = providerConfig.models[model];
    const config: KimiDecisionConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new KimiDecisionClient(config);
  }

  private createNVIDIA(providerConfig: any, model: string): NVIDIADecisionClient {
    const modelConfig = providerConfig.models[model];
    const config: NVIDIADecisionConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new NVIDIADecisionClient(config);
  }

  private createGLM(providerConfig: any, model: string): GLMDecisionClient {
    const modelConfig = providerConfig.models[model];
    const config: GLMDecisionConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      capabilities: modelConfig.capabilities,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new GLMDecisionClient(config);
  }

  private createOpenAI(providerConfig: any, model: string): KimiDecisionClient {
    const modelConfig = providerConfig.models[model];
    const config: KimiDecisionConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new KimiDecisionClient(config);
  }

  private createAnthropic(providerConfig: any, model: string): KimiDecisionClient {
    const modelConfig = providerConfig.models[model];
    const config: KimiDecisionConfig = {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    };
    return new KimiDecisionClient(config);
  }
}

export function createDecisionClientFactory(): DecisionClientFactory {
  return new DecisionClientFactoryImpl();
}
