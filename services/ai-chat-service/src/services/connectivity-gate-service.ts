export interface ConnectivityState {
  ok: boolean;
  message?: string;
  latencyMs?: number;
}

/**
 * Connectivity Gate Service - Fail-close gate for connectivity-dependent operations
 *
 * This service is a singleton that manages connectivity state.
 * When connectivity fails, it blocks new message-start operations
 * Session creation/list/get/recovery endpoints remain functional.
 */
export class ConnectivityGateService {
  private _connectivityState: ConnectivityState | undefined;
  private _lastConnectivityCheckTime: number = 0;

  /**
   * Get the current connectivity state
   */
  get state(): ConnectivityState | undefined {
    return this._connectivityState;
  }

  /**
   * Set connectivity state (typically called after connectivity test)
   */
  setConnectivityState(state: ConnectivityState): void {
    this._connectivityState = state;
    this._lastConnectivityCheckTime = Date.now();
  }

  /**
   * Check if connectivity has failed (used by message-start endpoint)
   */
  isConnectivityFailed(): boolean {
    return this._connectivityState !== undefined && !this._connectivityState.ok;
  }

  /**
   * Clear connectivity state (used when connectivity is restored)
   */
  clearConnectivityState(): void {
    this._connectivityState = undefined;
    this._lastConnectivityCheckTime = Date.now();
  }
}

export const connectivityGateService = new ConnectivityGateService();
