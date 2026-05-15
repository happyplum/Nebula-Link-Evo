export interface TestScenario {
  id: string;
  functional_module_id: string;
  name: string;
  description: string;
  preconditions?: string[];
  expected_results?: string[];
  created_at: string;
  updated_at: string;
}

export interface UpdateScenarioRequest {
  name: string;
  description?: string;
  preconditions?: string[];
  expected_results?: string[];
}
