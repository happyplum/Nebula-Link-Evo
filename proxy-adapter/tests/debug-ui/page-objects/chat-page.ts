// Chat panel page object
import { Page } from '@playwright/test';
import { BasePage } from './base-page.js';

export class ChatPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }
}
