export interface UnboundModule {
  moduleId: string;
  moduleName: string;
}

export interface TransitionErrorResponse {
  error: {
    code: 'DELIVERABLES_NOT_MET';
    message: string;
    details: string[];
  };
}
