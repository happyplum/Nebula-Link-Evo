/**
 * Report HTML Generator
 *
 * Generates a self-contained HTML page from a ProjectDiagnosisReport.
 * All user/AI-provided text is XSS-escaped. Dark theme CSS is embedded.
 * No template engine dependency.
 */
import { escapeHtml } from './html-escape.js';
import type { ProjectDiagnosisReport } from '../types/ai-intervention.js';

export function generateReportHtml(report: ProjectDiagnosisReport): string {
  const projectId = escapeHtml(report.projectId);
  const totalRuns = report.totalRuns;
  const failedRuns = report.failedRuns;
  const diagnosedRuns = report.diagnosedRuns;
  const undiagnosedRuns = report.undiagnosedRuns;
  const passRate = totalRuns > 0 ? ((totalRuns - failedRuns) / totalRuns * 100).toFixed(1) : '100.0';

  const distributionRows = report.failureDistribution
    .map((item) => {
      const type = escapeHtml(item.type);
      const count = item.count;
      return `<tr><td>${type}</td><td>${count}</td></tr>`;
    })
    .join('\n');

  const recentFailureRows = report.recentFailures
    .map((item) => {
      const runId = escapeHtml(item.runId);
      const failureType = escapeHtml(item.failureType);
      const diagnosis = escapeHtml(item.diagnosis);
      const timestamp = escapeHtml(item.timestamp);
      return `<tr><td>${runId}</td><td>${failureType}</td><td>${diagnosis}</td><td>${timestamp}</td></tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Diagnosis Report — ${projectId}</title>
<style>
  :root { --bg: #1a1a2e; --card: #16213e; --text: #e0e0e0; --accent: #0f3460; --border: #2a2a4a; --th: #0f3460; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 2rem; }
  h1 { margin-bottom: 1rem; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; text-align: center; }
  .stat .value { font-size: 1.8rem; font-weight: 700; }
  .stat .label { font-size: 0.85rem; color: #aaa; margin-top: 0.25rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  th { background: var(--th); text-align: left; padding: 0.75rem 1rem; }
  td { padding: 0.75rem 1rem; border-top: 1px solid var(--border); word-break: break-word; }
  h2 { margin-bottom: 0.75rem; }
  .empty { color: #888; font-style: italic; }
</style>
</head>
<body>
<h1>Project Diagnosis Report</h1>
<div class="summary">
  <div class="stat"><div class="value">${projectId}</div><div class="label">Project</div></div>
  <div class="stat"><div class="value">${totalRuns}</div><div class="label">Total Runs</div></div>
  <div class="stat"><div class="value">${failedRuns}</div><div class="label">Failed</div></div>
  <div class="stat"><div class="value">${diagnosedRuns}</div><div class="label">Diagnosed</div></div>
  <div class="stat"><div class="value">${undiagnosedRuns}</div><div class="label">Undiagnosed</div></div>
  <div class="stat"><div class="value">${passRate}%</div><div class="label">Pass Rate</div></div>
</div>
<h2>Failure Distribution</h2>
${report.failureDistribution.length > 0
    ? `<table><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>${distributionRows}</tbody></table>`
    : '<p class="empty">No failures recorded.</p>'}
<h2>Recent Failures</h2>
${report.recentFailures.length > 0
    ? `<table><thead><tr><th>Run ID</th><th>Type</th><th>Diagnosis</th><th>Timestamp</th></tr></thead><tbody>${recentFailureRows}</tbody></table>`
    : '<p class="empty">No recent failures.</p>'}
</body>
</html>`;
}
