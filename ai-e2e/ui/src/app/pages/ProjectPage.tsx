import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfigPanel } from '../../features/project/components/ConfigPanel.js';
import { AnalysisPanel } from '../../features/analysis/components/AnalysisPanel.js';
import ExplorationPanel from '../../features/exploration/components/ExplorationPanel.js';
import { ScenarioPanel } from '../../features/scenario/components/ScenarioPanel.js';
import ScriptPanel from '../../features/scripts/components/ScriptPanel.js';
import ExecutionPanel from '../../features/execution/components/ExecutionPanel.js';
import { ReportPanel } from '../../features/report/components/ReportPanel.js';
import { useProject } from '../../features/project/store/projectApi.js';

const TABS = [
  { value: 'config', label: '配置' },
  { value: 'analysis', label: 'PRD 分析' },
  { value: 'scenario', label: '场景' },
  { value: 'exploration', label: '探索' },
  { value: 'scripts', label: '脚本' },
  { value: 'execution', label: '执行' },
  { value: 'report', label: '报告' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId || '');
  const [activeTab, setActiveTab] = useState<TabValue>('config');

  return (
    <div className="flex h-full flex-col">
      <Tabs key={projectId} value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex h-full flex-col">
        {/* Tab Bar */}
        <div className="border-b border-border-default bg-surface-content px-6 pt-4">
          <h1 className="mb-3 text-lg font-semibold text-text-primary">
            项目: {project?.name || projectId}
          </h1>
          <TabsList className="h-9 w-full justify-start rounded-none border-b-0 bg-transparent p-0">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="rounded-none border-b-2 border-transparent px-4 py-2 text-[13px] text-text-muted data-[state=active]:border-b-status-info data-[state=active]:text-text-primary data-[state=active]:shadow-none"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          <TabsContent value="config" className="mt-0">
            {activeTab === 'config' && <ConfigPanel />}
          </TabsContent>
          <TabsContent value="analysis" className="mt-0">
            {activeTab === 'analysis' && <AnalysisPanel />}
          </TabsContent>
          <TabsContent value="scenario" className="mt-0">
            {activeTab === 'scenario' && <ScenarioPanel />}
          </TabsContent>
          <TabsContent value="exploration" className="mt-0">
            {activeTab === 'exploration' && <ExplorationPanel />}
          </TabsContent>
          <TabsContent value="scripts" className="mt-0">
            {activeTab === 'scripts' && <ScriptPanel />}
          </TabsContent>
          <TabsContent value="execution" className="mt-0">
            {activeTab === 'execution' && <ExecutionPanel />}
          </TabsContent>
          <TabsContent value="report" className="mt-0">
            {activeTab === 'report' && projectId && <ReportPanel projectId={projectId} />}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
