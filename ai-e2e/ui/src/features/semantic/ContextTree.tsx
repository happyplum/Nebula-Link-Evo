import {
  CheckCircle2,
  Circle,
  FileText,
  Layers3,
  LoaderCircle,
  MinusCircle,
  Network,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import type { SemanticWorkspace } from './types.js';
import { text } from './types.js';

function assetName(payload: Record<string, unknown>, fallback: string) {
  return text(payload.name, fallback);
}

function todoIcon(state: string) {
  if (state === 'succeeded' || state === 'passed') return CheckCircle2;
  if (state === 'running') return LoaderCircle;
  if (state === 'failed' || state === 'blocked') return XCircle;
  if (state === 'skipped' || state === 'cancelled') return MinusCircle;
  return Circle;
}

export function ContextTree({
  workspace,
  pageId,
  moduleId,
  scenarioId,
  todos = [],
  onPreview,
  onSelectPage,
  onSelectModule,
  onSelectScenario,
}: {
  workspace: SemanticWorkspace;
  pageId: string;
  moduleId: string;
  scenarioId: string;
  todos?: Array<Record<string, unknown>>;
  onPreview: (type: 'prd' | 'module' | 'scenario') => void;
  onSelectPage: (id: string) => void;
  onSelectModule: (id: string) => void;
  onSelectScenario: (id: string) => void;
}) {
  return (
    <aside className="semantic-context-tree" aria-label="资产与运行上下文">
      <div className="semantic-panel-heading">
        <div>
          <small>AUTHORING SCOPE</small>
          <strong>资产上下文</strong>
        </div>
        <span>{workspace.functionalModules.length + workspace.scenarios.length}</span>
      </div>
      <div className="semantic-tree-scroll">
        <button type="button" className="semantic-tree-root" onClick={() => onPreview('prd')}>
          <FileText aria-hidden="true" />
          <span>
            <strong>产品需求 PRD</strong>
            <small>{workspace.prdDocuments.length} 份来源文档</small>
          </span>
        </button>

        <div className="semantic-tree-group">
          <div className="semantic-tree-label">
            <Layers3 aria-hidden="true" /> 页面与模块
          </div>
          {workspace.pages.map((page) => {
            const pageModules = workspace.functionalModules.filter(
              (module) => module.primaryPageDefinitionId === page.id
            );
            const selected = page.id === pageId;
            return (
              <div className="semantic-tree-branch" key={page.id}>
                <button
                  type="button"
                  className={selected ? 'is-active' : ''}
                  onClick={() => onSelectPage(page.id)}
                >
                  <span className="semantic-tree-dot" />
                  <span>
                    <strong>{assetName(page.currentRevision.payload, page.pageKey)}</strong>
                    <small>{text(page.currentRevision.payload.routeTemplate, page.pageKey)}</small>
                  </span>
                </button>
                {selected &&
                  pageModules.map((module) => (
                    <button
                      type="button"
                      key={module.id}
                      className={`semantic-tree-child${module.id === moduleId ? ' is-active' : ''}`}
                      onClick={() => {
                        onSelectModule(module.id);
                        onPreview('module');
                      }}
                    >
                      <span className="semantic-tree-line" />
                      <span>
                        <strong>
                          {assetName(module.currentRevision.payload, module.moduleKey)}
                        </strong>
                        <small>
                          {module.currentRevision.readinessStatus ??
                            module.currentRevision.validationStatus}
                        </small>
                      </span>
                    </button>
                  ))}
              </div>
            );
          })}
        </div>

        <div className="semantic-tree-group">
          <div className="semantic-tree-label">
            <Network aria-hidden="true" /> 场景调用 DAG
          </div>
          {workspace.scenarios.map((scenario) => {
            const calls = Array.isArray(scenario.currentRevision.payload.calls)
              ? scenario.currentRevision.payload.calls.length
              : 0;
            return (
              <button
                type="button"
                key={scenario.id}
                className={`semantic-scenario-row${scenario.id === scenarioId ? ' is-active' : ''}`}
                onClick={() => {
                  onSelectScenario(scenario.id);
                  onPreview('scenario');
                }}
              >
                <PlayCircle aria-hidden="true" />
                <span>
                  <strong>{scenario.name}</strong>
                  <small>{calls} 个调用节点</small>
                </span>
              </button>
            );
          })}
        </div>

        {todos.length > 0 && (
          <div className="semantic-tree-group semantic-todos">
            <div className="semantic-tree-label">
              <CheckCircle2 aria-hidden="true" /> 运行 TODO
            </div>
            {todos.map((todo, index) => {
              const state = text(todo.state, 'pending');
              const Icon = todoIcon(state);
              return (
                <div className={`semantic-todo is-${state}`} key={text(todo.id, String(index))}>
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{text(todo.todoKey, `TODO ${index + 1}`)}</strong>
                    <small>{state}</small>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
