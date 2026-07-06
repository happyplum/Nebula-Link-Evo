/**
 * Shared HTTP client helpers for the dual-backend client layer.
 *
 * After the ai-chat-service split, ai-e2e talks to two backends:
 *   - ai-chat-service (:3001) — AI generation, chat sessions, connectivity probes
 *   - proxy-adapter   (:3000) — browser control, debug DOM, LiveKit token
 *
 * Both clients share the same JSON-over-HTTP shape (axios) and the same
 * error → ServiceError mapping. This module centralises that logic so each
 * client only declares its own endpoints.
 */
import crypto from 'node:crypto';
import axios, { type AxiosInstance, isAxiosError } from 'axios';
import { ServiceError } from '../services/service-error.js';

/** Optional headers shared by every outbound request. */
export interface ClientHeaderOptions {
  projectId?: string;
}

/** Normalises a base URL: trims trailing slashes; empty/blank → null (means "not configured"). */
export function normalizeBaseUrl(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

/**
 * Resolves a base URL from (1) an explicit argument, then (2) an env var,
 * then (3) a default. An explicit empty string is honoured as "disabled".
 */
export function resolveBaseUrl(
  explicit: string | undefined,
  envVar: string | undefined,
  defaultValue: string,
): string | null {
  if (explicit !== undefined) {
    return normalizeBaseUrl(explicit);
  }
  if (envVar !== undefined) {
    return normalizeBaseUrl(envVar);
  }
  return normalizeBaseUrl(defaultValue);
}

/** Creates a JSON axios instance bound to the given base URL (or none when unconfigured). */
export function createJsonClient(baseUrl: string | null): AxiosInstance {
  return axios.create({
    baseURL: baseUrl ?? undefined,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/** Builds per-request headers including a fresh request id and optional project id. */
export function buildRequestHeaders(options: ClientHeaderOptions | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'x-request-id': crypto.randomUUID(),
  };
  if (options?.projectId) {
    headers['x-project-id'] = options.projectId;
  }
  return headers;
}

/**
 * Maps an axios/unknown error to a ServiceError, prefixing messages with
 * `serviceLabel` so callers can tell which backend failed.
 *
 * `badGatewayMessage` is returned for HTTP 502 responses (AI generation failure
 * upstream); other statuses follow the standard status → ServiceError mapping.
 */
export function mapAxiosToServiceError(
  error: unknown,
  serviceLabel: string,
  fallback: string,
  badGatewayMessage?: string,
): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }

  if (isAxiosError(error)) {
    // No request was created — client-side setup failure.
    if (error.request == null) {
      return ServiceError.internal(`${serviceLabel} request failed`);
    }

    // Request sent but no response received — network/DNS/unreachable.
    if (error.response == null) {
      const detail = error.code ? ` (code: ${error.code})` : '';
      return ServiceError.internal(`${serviceLabel} unreachable${detail}`);
    }

    const status = error.response.status;
    const message = extractServerMessage(error, fallback);

    if (status === 502 && badGatewayMessage) {
      return ServiceError.internal(badGatewayMessage);
    }

    return mapHttpStatusToServiceError(status, message, serviceLabel);
  }

  return ServiceError.internal(
    error instanceof Error ? error.message : fallback,
  );
}

/** Extracts a human-readable message from an axios error response body. */
export function extractServerMessage(
  error: { response?: { data?: { error?: string; message?: string } } },
  fallback: string,
): string {
  const body = error.response?.data;
  return body?.error ?? body?.message ?? fallback;
}

/** Maps an HTTP status code to the corresponding ServiceError factory. */
export function mapHttpStatusToServiceError(
  status: number,
  message: string,
  serviceLabel: string,
): ServiceError {
  switch (status) {
    case 400:
      return ServiceError.validation(message);
    case 401:
      return ServiceError.unauthorized(message);
    case 403:
      return ServiceError.forbidden(message);
    case 404:
      return ServiceError.notFound(message);
    case 409:
      return ServiceError.conflict(message);
    case 503:
      // Preserve legacy contract: 503 maps to a fixed "unavailable" message
      // with internal (500) status code, not ServiceError.unavailable (503).
      return ServiceError.internal(`${serviceLabel} unavailable`);
    default:
      return ServiceError.internal(message);
  }
}

/** Throws a ServiceError when the client has no configured base URL. */
export function ensureConfigured(baseUrl: string | null, missingMessage: string): void {
  if (!baseUrl) {
    throw ServiceError.internal(missingMessage);
  }
}
