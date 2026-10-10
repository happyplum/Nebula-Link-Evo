/**
 * Vision Marker Injector Types
 *
 * Shared types between Playwright Server and Proxy Adapter for the
 * Vision Marker Injector feature.
 */

/**
 * API version for the Vision Marker Injector endpoints.
 * Increment this when making breaking changes to the data structures.
 */
export const VISION_MARKER_API_VERSION = '2.0' as const;

/**
 * Bounding box coordinates for an element.
 */
export interface BoundingBox {
  /** X coordinate in pixels */
  x: number;
  /** Y coordinate in pixels */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Multiple selector strategies for robust element targeting.
 * Provides fallback options when primary selectors fail.
 */
export interface LocatorBundle {
  /** ARIA role selector (e.g., 'button', 'link') */
  role?: string;
  /** Test ID selector (data-testid attribute) */
  testid?: string;
  /** ARIA label selector */
  aria?: string;
  /** Text content match */
  text?: string;
  /** Unique CSS selector */
  css?: string;
  /** XPath selector */
  xpath?: string;
}

/**
 * Locator bundle for a single DOM element.
 * Contains multiple selector strategies for element identification.
 */
export interface ElementLocator {
  /** Unique element identifier (data-nebula-id) */
  id: string;
  /** Multi-strategy locators for element targeting */
  locator_bundle: LocatorBundle;
  /** Bounding box coordinates */
  bbox: BoundingBox;
  /** HTML tag name */
  tag: string;
  /** Optional text content */
  text?: string;
}


/**
 * Individual element in simplified DOM.
 */
export interface SimplifiedElement {
  /** HTML tag name */
  tag: string;
  /** Optional element identifier (data-nebula-id) */
  id?: string;
  /** Optional CSS class name */
  class?: string;
  /** Optional text content */
  text?: string;
  /** Optional additional attributes */
  attributes?: Record<string, string>;
}

/**
 * Simplified DOM tree structure.
 */
export interface SimplifiedDOM {
  /** List of elements in the DOM */
  elements: SimplifiedElement[];
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
}

/**
 * New response structure for /dom/simplified endpoint.
 * Version 2.0 with vision markers and multi-strategy locators.
 */
export interface DOMSnapshotResponse {
  /** Unique snapshot identifier (UUID v4) */
  snapshot_id: string;
  /** API version */
  version: '2.0';
  /** Gzip compressed base64 screenshot with marker overlay */
  annotated_screenshot_base64: string;
  /** Map of element IDs to their locators */
  elements_map: Record<string, ElementLocator>;
  /** Simplified DOM tree */
  simplified_dom: SimplifiedDOM;
}

/**
 * Element information returned by /dom/element-at endpoint.
 */
export interface ElementInfo {
  /** CSS selector */
  selector: string;
  /** HTML tag name */
  tag: string;
  /** Element ID */
  id?: string;
  /** CSS class name */
  class?: string;
  /** Input type attribute */
  type?: string;
  /** Form name attribute */
  name?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Text content */
  text?: string;
  /** Link URL */
  href?: string;
  /** Image source URL */
  src?: string;
  /** Image alt text */
  alt?: string;
  /** Bounding box */
  bbox?: BoundingBox;
  /** Whether element is visible */
  isVisible: boolean;
  /** Whether element is interactable */
  isInteractable: boolean;
}
