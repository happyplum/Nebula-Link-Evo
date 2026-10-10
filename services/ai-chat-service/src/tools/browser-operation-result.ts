import type { McpResult } from '@deepseek-ai/dsh-mcp-client';
import {
  BrowserOperationRecordSchema,
  type BrowserOperationRecord,
} from '@nebula-link-evo/shared/types/browser-operation-result';
import { TypeCompiler } from '@sinclair/typebox/compiler';

const operationRecordValidator = TypeCompiler.Compile(BrowserOperationRecordSchema);

/** Admits only the gateway's structured result; presentation text is never evidence. */
export function readBrowserOperationResult(result: McpResult): BrowserOperationRecord | null {
  const operation = result.structuredContent;
  return operationRecordValidator.Check(operation) ? operation : null;
}
