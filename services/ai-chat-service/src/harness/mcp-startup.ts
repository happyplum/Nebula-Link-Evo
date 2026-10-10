const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 15_000;

export interface McpStartupHandle {
  await(): Promise<unknown>;
  dispose(): Promise<void>;
}

/** Bounds discovery and fully retires the Cordis fiber before startup can continue. */
export async function awaitMcpStartup(
  handle: McpStartupHandle,
  serverName: string,
  timeoutMs = DEFAULT_MCP_STARTUP_TIMEOUT_MS
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('MCP startup timeout must be a positive safe integer');
  }

  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`MCP server ${serverName} discovery exceeded ${timeoutMs}ms`)),
      timeoutMs
    );
    timer.unref();
  });
  try {
    await Promise.race([handle.await(), expired]);
  } catch (error) {
    if (timer) clearTimeout(timer);
    await handle.dispose();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
