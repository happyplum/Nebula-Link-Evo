import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useProjects } from '../../project/store/projectApi.js';
import { executionKeys, fetchRuns } from '../store/executionApi.js';
import type { ExecutionRun } from '../store/executionApi.js';

/**
 * 聚合所有项目的最近执行记录，按开始时间倒序取前 `limit` 条。
 * 使用 `useQueries` 一次性发起所有项目的 runs 查询，避免在循环中调用 hook。
 */
export function useRecentRuns(limit = 5): { runs: ExecutionRun[]; isLoading: boolean } {
  const { data: projects = [] } = useProjects();
  const results = useQueries({
    queries: projects.map((p) => ({
      queryKey: executionKeys.runs(p.id),
      queryFn: () => fetchRuns(p.id),
    })),
  });

  const isLoading = results.some((r) => r.isLoading);

  const runs = useMemo(() => {
    const all = results.flatMap((r) => (r.data ?? []) as ExecutionRun[]);
    // ExecutionRun 没有统一 created_at，用 started_at 作为时间排序依据
    all.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    return all.slice(0, limit);
  }, [results, limit]);

  return { runs, isLoading };
}
