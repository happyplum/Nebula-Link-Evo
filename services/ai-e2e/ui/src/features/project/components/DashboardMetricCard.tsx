import React from 'react';

interface DashboardMetricCardProps {
  label: string;
  value: string | number;
  trend?: string;
  status?: 'neutral' | 'success' | 'error';
}

export const DashboardMetricCard: React.FC<DashboardMetricCardProps> = ({
  label,
  value,
  trend,
  status = 'neutral',
}) => (
  <div className="rounded-lg border border-border-default bg-surface-panel p-4">
    <div className="text-xs text-text-secondary">{label}</div>
    <div className="mt-1 text-2xl font-semibold text-text-primary">{value}</div>
    {trend && (
      <div
        className={`mt-1 text-xs ${
          status === 'success'
            ? 'text-status-success'
            : status === 'error'
              ? 'text-status-error'
              : 'text-text-muted'
        }`}
      >
        {trend}
      </div>
    )}
  </div>
);
