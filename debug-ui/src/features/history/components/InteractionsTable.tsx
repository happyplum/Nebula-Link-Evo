import { useState } from 'react';
import { useInteractions } from '../api/history.queries.js';
import { useInteractionFilters } from '../hooks/useInteractionFilters.js';
import { formatTime, formatDuration } from '@/shared/lib/date.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { InteractionDetailModal } from './InteractionDetailModal.js';
import type { Interaction } from '../types/index.js';
import styles from './InteractionsTable.module.css';

export function InteractionsTable() {
  const { filters, updateFilters } = useInteractionFilters();
  const { data, isLoading, error } = useInteractions(filters);
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <StatusIndicator status="loading" label="Loading interactions..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <StatusIndicator status="error" label="Failed to load interactions" />
      </div>
    );
  }

  const interactions = data?.data || [];

  return (
    <div className={styles.wrapper}>
      <div className={styles.filters}>
        <select
          className={styles.select}
          value={filters.actionType || ''}
          onChange={(e) => updateFilters({ actionType: e.target.value || undefined })}
          data-testid="interaction-filter-action-type"
        >
          <option value="">All Actions</option>
          <option value="click">Click</option>
          <option value="type">Type</option>
          <option value="scroll">Scroll</option>
          <option value="navigate">Navigate</option>
          <option value="wait">Wait</option>
          <option value="screenshot">Screenshot</option>
          <option value="focus">Focus</option>
          <option value="blur">Blur</option>
          <option value="hover">Hover</option>
          <option value="value">Value</option>
          <option value="dispatch">Dispatch</option>
          <option value="mcp_call">MCP Call</option>
        </select>

        <select
          className={styles.select}
          value={filters.success === undefined ? '' : String(filters.success)}
          onChange={(e) => {
            const val = e.target.value;
            updateFilters({ success: val === '' ? undefined : val === 'true' });
          }}
          data-testid="interaction-filter-success"
        >
          <option value="">All Statuses</option>
          <option value="true">Success</option>
          <option value="false">Failed</option>
        </select>
      </div>

      {interactions.length === 0 ? (
        <div className={styles.empty}>No interactions found</div>
      ) : (
        <div className={styles.container} data-testid="interactions-table">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Target</th>
                <th>Locator</th>
                <th>Status</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((interaction) => (
                <tr
                  key={interaction.id}
                  className={styles.row}
                  onClick={() => setSelectedInteraction(interaction)}
                  data-testid="interactions-table-row"
                >
                  <td className={styles.timeCell}>{formatTime(interaction.timestamp)}</td>
                  <td>
                    <span className={styles.actionBadge}>{interaction.action_type}</span>
                  </td>
                  <td className={styles.targetCell}>{interaction.target_type}</td>
                  <td className={styles.locatorCell}>{interaction.locator_strategy || '-'}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${interaction.success ? styles.success : styles.error}`}>
                      {interaction.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td className={styles.latencyCell}>
                    {interaction.latency_ms != null ? formatDuration(interaction.latency_ms) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InteractionDetailModal
        interaction={selectedInteraction}
        onClose={() => setSelectedInteraction(null)}
      />
    </div>
  );
}
