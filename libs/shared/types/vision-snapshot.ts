/** Immutable proxy-owned evidence binding accepted by ai-chat-service Vision tools. */
export interface VisionSnapshotArtifactBindingV1 {
  artifactId: string;
  sha256: string;
  mimeType: 'application/json';
  sizeBytes: number;
}

export interface VisionSnapshotBindingV1 {
  schema: 'nebula.vision-snapshot-binding/1.0';
  sessionId: string;
  tabId: string;
  operationId: string;
  requestHash: string;
  leaseId: string;
  leaseSequence: number;
  snapshotId: string;
  status: 'succeeded';
  domArtifact: VisionSnapshotArtifactBindingV1;
}
