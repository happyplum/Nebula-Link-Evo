import { showError, showSuccess } from './ui.js';

interface Interaction {
  id: number;
  timestamp: number;
  snapshot_id: string | null;
  nebula_id: number | null;
  action_type: string;
  target_type: string;
  locator_strategy: string | null;
  success: boolean;
  attempts: number | null;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  failure_sample_path: string | null;
}

interface InteractionStats {
  total: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_latency_ms: number | null;
  avg_attempts: number | null;
  by_action_type: Record<string, number>;
  by_target_type: Record<string, number>;
}

let currentInteractions: Interaction[] = [];

export async function fetchInteractions(): Promise<void> {
  try {
    const actionTypeSelect = document.getElementById('filter-action-type') as HTMLSelectElement;
    const successSelect = document.getElementById('filter-success') as HTMLSelectElement;

    const params = new URLSearchParams();
    if (actionTypeSelect && actionTypeSelect.value) {
      params.append('action_type', actionTypeSelect.value);
    }
    if (successSelect && successSelect.value) {
      params.append('success', successSelect.value);
    }

    const locatorStrategySelect = document.getElementById(
      'filter-locator-strategy'
    ) as HTMLSelectElement;
    if (locatorStrategySelect && locatorStrategySelect.value) {
      params.append('locator_strategy', locatorStrategySelect.value);
    }

    const timeRangeSelect = document.getElementById('filter-time-range') as HTMLSelectElement;
    if (timeRangeSelect && timeRangeSelect.value) {
      const now = Date.now();
      let startTime = 0;
      if (timeRangeSelect.value === '1h') startTime = now - 60 * 60 * 1000;
      else if (timeRangeSelect.value === '24h') startTime = now - 24 * 60 * 60 * 1000;
      else if (timeRangeSelect.value === '7d') startTime = now - 7 * 24 * 60 * 60 * 1000;

      if (startTime > 0) {
        params.append('start_time', startTime.toString());
      }
    }

    const [interactionsRes, statsRes] = await Promise.all([
      fetch(`/debug/api/interactions?${params.toString()}`),
      fetch('/debug/api/interactions/stats'),
    ]);

    if (!interactionsRes.ok || !statsRes.ok) {
      throw new Error('Failed to fetch interactions data');
    }

    const interactionsData = await interactionsRes.json();
    const statsData = await statsRes.json();

    if (interactionsData.success) {
      currentInteractions = interactionsData.data;
      renderInteractionsTable(currentInteractions);
    }

    if (statsData.success) {
      renderInteractionStats(statsData.data);
    }
  } catch (error) {
    console.error('Error fetching interactions:', error);
    showError('获取交互历史失败');
  }
}

function renderInteractionsTable(interactions: Interaction[]): void {
  const tbody = document.getElementById('interactions-table-body');
  if (!tbody) return;

  if (interactions.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center p-4 text-muted">暂无交互记录</td></tr>';
    return;
  }

  let html = '';
  interactions.forEach((interaction, index) => {
    const time = new Date(interaction.timestamp).toLocaleString();
    const statusClass = interaction.success ? 'text-success' : 'text-error';
    const statusText = interaction.success ? '成功' : '失败';
    const latency = interaction.latency_ms ? `${interaction.latency_ms}ms` : '-';

    html += `
      <tr class="border-b border-border hover:bg-tertiary cursor-pointer" onclick="showInteractionDetail(${index})">
        <td class="p-2">${time}</td>
        <td class="p-2"><span class="badge bg-secondary">${interaction.action_type}</span></td>
        <td class="p-2">${interaction.target_type}</td>
        <td class="p-2">${interaction.locator_strategy || '-'}</td>
        <td class="p-2 ${statusClass}">${statusText}</td>
        <td class="p-2">${latency}</td>
        <td class="p-2">
          <button class="text-12" onclick="event.stopPropagation(); showInteractionDetail(${index})">详情</button>
          ${
            !interaction.success && interaction.failure_sample_path
              ? `
            <button class="text-12 ml-2 text-primary" onclick="event.stopPropagation(); viewFailureSample(${index})">查看样本</button>
          `
              : ''
          }
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function renderInteractionStats(stats: InteractionStats): void {
  const totalEl = document.getElementById('stat-total-interactions');
  const successRateEl = document.getElementById('stat-success-rate');
  const avgLatencyEl = document.getElementById('stat-avg-latency');

  if (totalEl) totalEl.textContent = stats.total.toString();
  if (successRateEl) {
    successRateEl.textContent = `${stats.success_rate.toFixed(1)}%`;
    successRateEl.className = `text-2xl font-bold ${stats.success_rate >= 80 ? 'text-success' : stats.success_rate >= 50 ? 'text-warning' : 'text-error'}`;
  }
  if (avgLatencyEl) {
    avgLatencyEl.textContent = stats.avg_latency_ms ? `${Math.round(stats.avg_latency_ms)}ms` : '-';
  }
}

export function showInteractionDetail(index: number): void {
  const interaction = currentInteractions[index];
  if (!interaction) return;

  const modal = document.getElementById('interaction-detail-modal');
  const body = document.getElementById('interaction-modal-body');
  if (!modal || !body) return;

  const time = new Date(interaction.timestamp).toLocaleString();
  const statusClass = interaction.success ? 'text-success' : 'text-error';
  const statusText = interaction.success ? '成功' : '失败';

  body.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div><span class="text-muted">ID:</span> ${interaction.id}</div>
        <div><span class="text-muted">时间:</span> ${time}</div>
        <div><span class="text-muted">操作类型:</span> <span class="badge bg-secondary">${interaction.action_type}</span></div>
        <div><span class="text-muted">目标类型:</span> ${interaction.target_type}</div>
        <div><span class="text-muted">状态:</span> <span class="${statusClass} font-bold">${statusText}</span></div>
        <div><span class="text-muted">耗时:</span> ${interaction.latency_ms ? interaction.latency_ms + 'ms' : '-'}</div>
        <div><span class="text-muted">尝试次数:</span> ${interaction.attempts || '-'}</div>
        <div><span class="text-muted">定位策略:</span> ${interaction.locator_strategy || '-'}</div>
        <div><span class="text-muted">快照 ID:</span> ${interaction.snapshot_id || '-'}</div>
        <div><span class="text-muted">Nebula ID:</span> ${interaction.nebula_id || '-'}</div>
      </div>

      ${
        !interaction.success
          ? `
        <div class="mt-4 p-3 bg-error-subtle border border-error rounded">
          <div class="text-error font-bold mb-1">错误信息</div>
          <div class="text-sm">
            <div><strong>Code:</strong> ${interaction.error_code || 'Unknown'}</div>
            <div class="mt-1">${interaction.error_message || 'No error message provided'}</div>
            ${
              interaction.failure_sample_path
                ? `
              <div class="mt-2">
                <button class="text-primary" onclick="viewFailureSample(${currentInteractions.indexOf(interaction)})">查看失败样本</button>
              </div>
            `
                : ''
            }
          </div>
        </div>
      `
          : ''
      }`;

  modal.style.display = 'flex';
}

export function closeInteractionModal(): void {
  const modal = document.getElementById('interaction-detail-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Expose globally
if (typeof window !== 'undefined') {
  (window as any).fetchInteractions = fetchInteractions;
  (window as any).showInteractionDetail = showInteractionDetail;
  (window as any).closeInteractionModal = closeInteractionModal;
  (window as any).viewFailureSample = viewFailureSample;
  (window as any).closeFailureSampleModal = closeFailureSampleModal;
}

export async function viewFailureSample(index: number): Promise<void> {
  const interaction = currentInteractions[index];
  if (!interaction || !interaction.failure_sample_path) {
    showError('失败样本路径不存在');
    return;
  }

  try {
    const res = await fetch(
      `/debug/api/failure-sample?path=${encodeURIComponent(interaction.failure_sample_path)}`
    );
    if (!res.ok) {
      throw new Error('Failed to fetch failure sample');
    }
    const data = await res.json();
    if (data.success && data.data) {
      showFailureSampleModal(data.data);
    } else {
      showError(data.error || '获取失败样本失败');
    }
  } catch (error) {
    console.error('Error viewing failure sample:', error);
    showError('获取失败样本失败');
  }
}

function showFailureSampleModal(sample: any): void {
  const modal = document.getElementById('failure-sample-modal') || createFailureSampleModal();
  const body = document.getElementById('failure-sample-modal-body');
  if (!modal || !body) return;

  const time = new Date(sample.timestamp).toLocaleString();
  const screenshotBase64 = sample.screenshot || '';
  const dom = sample.dom || null;
  const context = sample.context || null;

  body.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div><span class="text-muted">时间:</span> ${time}</div>
        <div><span class="text-muted">URL:</span> ${context?.url || '-'}</div>
      </div>

      ${
        screenshotBase64
          ? `
        <div class="mt-4">
          <h3 class="font-bold mb-2">失败截图</h3>
          <img src="data:image/png;base64,${screenshotBase64}" class="max-w-full border border-border rounded" alt="Failure Screenshot" />
        </div>
      `
          : ''
      }

      ${
        dom
          ? `
        <div class="mt-4">
          <h3 class="font-bold mb-2">DOM 结构</h3>
          <div class="bg-secondary p-3 rounded text-xs font-mono overflow-auto max-h-64">
            <pre>${JSON.stringify(dom, null, 2)}</pre>
          </div>
        </div>
      `
          : ''
      }

      ${
        context
          ? `
        <div class="mt-4 p-3 bg-error-subtle border border-error rounded">
          <h3 class="text-error font-bold mb-2">错误上下文</h3>
          <div class="text-sm space-y-1">
            <div><strong>Action:</strong> ${context.action?.type || 'Unknown'}</div>
            <div><strong>Error:</strong> ${context.error?.message || 'Unknown error'}</div>
            ${context.error?.stack ? `<div class="mt-1 text-xs font-mono">${context.error.stack}</div>` : ''}
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;

  modal.style.display = 'flex';
}

function createFailureSampleModal(): HTMLElement {
  const modal = document.createElement('div');
  modal.id = 'failure-sample-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 hidden';
  modal.innerHTML = `
    <div class="bg-background border border-border rounded-lg p-6 max-w-4xl max-h-[90vh] overflow-auto w-full mx-4">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">失败样本详情</h2>
        <button onclick="closeFailureSampleModal()" class="text-2xl">&times;</button>
      </div>
      <div id="failure-sample-modal-body"></div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

export function closeFailureSampleModal(): void {
  const modal = document.getElementById('failure-sample-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}
