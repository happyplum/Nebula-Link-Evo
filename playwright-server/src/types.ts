export interface OpenBrowserRequest {
  headless?: boolean;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface NavigateRequest {
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface ScreenshotRequest {
  fullPage?: boolean;
  type?: 'png' | 'jpeg';
  quality?: number;
}

export interface ScreenshotResponse {
  screenshot: string;
  viewport: {
    width: number;
    height: number;
  };
}

export interface ClickRequest {
  x: number;
  y: number;
}

export interface ClickBySelectorRequest {
  selector: string;
  options?: {
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    delay?: number;
    force?: boolean; // 强制点击，绕过可见性检查
  };
}

export interface TypeRequest {
  selector: string;
  text: string;
  options?: {
    delay?: number;
    clear?: boolean;
    force?: boolean; // 强制输入，绕过可见性检查
  };
}

export interface ScrollRequest {
  x?: number;
  y?: number;
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


export interface BrowserStatus {
  isOpen: boolean;
  currentUrl?: string;
  title?: string;
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
/**
 * Bounding box coordinates for an element position.
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Multi-strategy locators for robust element targeting.
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
export interface SimplifiedDOMResponse {
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
