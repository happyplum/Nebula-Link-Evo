// Monitor panel page object
import { Page } from '@playwright/test';
import { BasePage } from './base-page.js';

export class MonitorPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }
}
