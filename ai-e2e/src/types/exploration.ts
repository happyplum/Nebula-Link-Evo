/**
 * Exploration Session Types
 *
 * Exploration session entity for URL discovery sessions.
 */

// ========== EXPLORATION SESSION ENTITY ==========

/**
 * Exploration session entity.
 *
 * Based on database schema:
 * - exploration_sessions table with all fields
 */
export interface ExplorationSession {
  /** Unique exploration session identifier */
  id: string;
  /** Associated project ID */
  project_id: string;
  /** Start URL */
  start_url: string;
  /** Session status */
  status: 'running' | 'completed' | 'failed';
  /** Total pages visited */
  pages_visited: number;
  /** Total URLs discovered */
  total_urls: number;
  /** Start timestamp (ISO string) */
  started_at: string;
  /** End timestamp (ISO string, optional) */
  ended_at?: string;
  /** Error message if failed */
  error_message?: string;
  /** Creation timestamp (ISO string) */
  created_at: string;
}
