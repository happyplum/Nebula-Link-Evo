import { afterEach, describe, expect, it, vi } from 'vitest';
import { semanticApi } from './api.js';
import { fetchProjects } from '../project/store/projectApi.js';
import { requestJson } from '../../shared/api/request.js';

afterEach(() => vi.unstubAllGlobals());

describe('v1 JSON API responses', () => {
  it('keeps success data and meta together in the shared request entry', async () => {
    const envelope = {
      data: { versions: [] },
      meta: { requestId: 'req-1', correlationId: 'cor-1', stateVersion: 4 },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope))));
    expect(await requestJson('/api/v1/example')).toEqual(envelope);
  });
  const problem = {
    code: 'side_effect_approval_stale',
    message: '风险投影已变化，需要重新审批',
    retryable: false,
    correlationId: 'correlation-409',
    details: { scope: { revision: 7 }, unknownFutureField: ['preserve', 42] },
  };

  it.each([
    ['semantic', () => semanticApi.getRunSnapshot('run-1')],
    ['project', () => fetchProjects()],
  ])('%s preserves the entire API Problem and HTTP status', async (_name, request) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(problem), { status: 409 }))
    );
    await expect(request()).rejects.toMatchObject({ ...problem, status: 409 });
  });

  it.each([
    ['semantic', () => semanticApi.getRunSnapshot('run-1')],
    ['project', () => fetchProjects()],
  ])('%s retains HTTP status for non-JSON errors', async (_name, request) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>upstream failure</html>', { status: 503 }))
    );
    await expect(request()).rejects.toMatchObject({ status: 503, message: '请求失败（503）' });
  });
});
