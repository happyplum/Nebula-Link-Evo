/**
 * Filter state helper for the interactions list.
 * Manages URL-syncable filter params with defaults.
 */

import { useCallback, useState } from 'react';
import type { InteractionFilters } from '../types/index.js';

const DEFAULT_FILTERS: InteractionFilters = {
  limit: 50,
  offset: 0,
};

/** Manages interaction filter state with reset capability. */
export function useInteractionFilters(initial?: InteractionFilters) {
  const [filters, setFilters] = useState<InteractionFilters>({
    ...DEFAULT_FILTERS,
    ...initial,
  });

  const updateFilters = useCallback((patch: Partial<InteractionFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  return { filters, updateFilters, resetFilters };
}
