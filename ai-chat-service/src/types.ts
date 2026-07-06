/**
 * Proxy Adapter Types
 *
 * Defines adapter-specific types. Uses a simplified Action type for internal
 * backward compatibility while also exporting discriminated union types from shared.
 */

// ========== CORE ACTION TYPE (Internal - for backward compatibility) ==========

/**
 * Simplified Action type for internal use.
 * The shared package has discriminated union types, but internal code
 * uses this simpler representation for flexibility.
 */
export interface Action {
  type: 'click' | 'type' | 'scroll' | 'wait' | 'navigate' | 'screenshot' | 'finish' | 'mcp_call' | 'focus' | 'blur' | 'hover' | 'value' | 'dispatch';
  params: Record<string, unknown>;
  reasoning?: string;
}

// ========== RESOLVED TARGET ==========

/**
 * Extended ResolvedTarget with format discriminator for internal use.
 * The shared ResolvedTarget uses 'type', but internal code uses 'format'.
 */
export type ResolvedTarget =
  | {
      format: 'target_id';
      target_id: number;
      snapshot_id?: string;
    }
  | {
      format: 'selector';
      selector: string;
    };

// ========== RESULT TYPES ==========

export interface ActionResult {
  action: Action;
  success: boolean;
  message: string;
  screenshot?: string;
}

// ========== DOM TYPES ==========

export interface UIElement {
  id: number;
  type:
    | 'button'
    | 'input'
    | 'link'
    | 'checkbox'
    | 'radio'
    | 'select'
    | 'text'
    | 'image'
    | 'container'
    | 'other';
  text?: string;
  placeholder?: string;
  bbox: [number, number, number, number];
  center: [number, number];
  confidence: number;
  description?: string;
}

export interface DOMElement {
  tag: string;
  id?: string;
  class?: string;
  type?: string;
  name?: string;
  placeholder?: string;
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
  isInteractable: boolean;
}

export interface SimplifiedDOM {
  url: string;
  title: string;
  elements: DOMElement[];
  viewport: { width: number; height: number };
}

export interface ScreenshotData {
  screenshot: string;
  viewport: { width: number; height: number };
}

export interface ElementInfo {
  selector: string;
  tag: string;
  id?: string;
  class?: string;
  type?: string;
  name?: string;
  placeholder?: string;
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
  isInteractable: boolean;
}