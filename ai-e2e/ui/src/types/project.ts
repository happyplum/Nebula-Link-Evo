export type ProjectStatus =
  | 'draft'
  | 'configuring'
  | 'analyzing'
  | 'analyzed'
  | 'exploring'
  | 'explored'
  | 'generating'
  | 'ready'
  | 'running'
  | 'completed';

export interface Project {
  id: string;
  name: string;
  target_base_url?: string;
  description?: string;
  status: ProjectStatus;
  tags?: string[];
  login_script_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}
