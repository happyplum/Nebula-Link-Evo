import { Type } from '@sinclair/typebox';
import { BoundingBoxSchema } from './common.js';

/**
 * Locator bundle for robust element targeting.
 */
const LocatorBundleSchema = Type.Object({
  /** ARIA role selector (e.g., 'button', 'link') */
  role: Type.Optional(Type.String()),
  /** Test ID selector (data-testid attribute) */
  testid: Type.Optional(Type.String()),
  /** ARIA label selector */
  aria: Type.Optional(Type.String()),
  /** Text content match */
  text: Type.Optional(Type.String()),
  /** Unique CSS selector */
  css: Type.Optional(Type.String()),
  /** XPath selector */
  xpath: Type.Optional(Type.String()),
});

/**
 * Element locator for a single DOM element.
 */
const ElementLocatorSchema = Type.Object({
  /** Unique element identifier (data-nebula-id) */
  id: Type.String(),
  /** Multi-strategy locators for element targeting */
  locator_bundle: LocatorBundleSchema,
  /** Bounding box coordinates */
  bbox: BoundingBoxSchema,
  /** HTML tag name */
  tag: Type.String(),
  /** Optional text content */
  text: Type.Optional(Type.String()),
});

/**
 * Individual element in simplified DOM.
 */
const SimplifiedElementSchema = Type.Object({
  /** HTML tag name */
  tag: Type.String(),
  /** Optional element identifier (data-nebula-id) */
  id: Type.Optional(Type.String()),
  /** Optional CSS class name */
  class: Type.Optional(Type.String()),
  /** Optional text content */
  text: Type.Optional(Type.String()),
  /** Optional additional attributes */
  attributes: Type.Optional(Type.Record(Type.String(), Type.String())),
});

/**
 * Simplified DOM tree structure.
 */
const SimplifiedDOMSchema = Type.Object({
  /** List of elements in the DOM */
  elements: Type.Array(SimplifiedElementSchema),
  /** Viewport dimensions */
  viewport: Type.Object({
    width: Type.Number(),
    height: Type.Number(),
  }),
});

/**
 * New response structure for /dom/simplified endpoint.
 * Version 2.0 with vision markers and multi-strategy locators.
 */
export const SimplifiedDOMResponseSchema = Type.Object({
  /** Unique snapshot identifier (UUID v4) */
  snapshot_id: Type.String(),
  /** API version */
  version: Type.Literal('2.0'),
  /** Gzip compressed base64 screenshot with marker overlay */
  annotated_screenshot_base64: Type.String(),
  /** Map of element IDs to their locators */
  elements_map: Type.Record(Type.String(), ElementLocatorSchema),
  /** Simplified DOM tree */
  simplified_dom: SimplifiedDOMSchema,
});
