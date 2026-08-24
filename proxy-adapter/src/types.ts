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
