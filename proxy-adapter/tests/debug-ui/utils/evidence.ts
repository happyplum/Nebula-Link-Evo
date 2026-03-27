// Evidence capture utilities for Debug UI E2E tests
import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface TestEvidence {
  testName: string;
  timestamp: string;
  screenshots: string[];
  logs: string[];
}

export class EvidenceCapture {
  private evidence: TestEvidence[] = [];
  private currentTest: TestEvidence | null = null;
  private evidenceDir: string;

  constructor(evidenceDir: string = 'test-results/evidence') {
    this.evidenceDir = evidenceDir;
    this.ensureEvidenceDir();
  }

  private ensureEvidenceDir(): void {
    if (!fs.existsSync(this.evidenceDir)) {
      fs.mkdirSync(this.evidenceDir, { recursive: true });
    }
  }

  /**
   * Start capturing evidence for a test
   */
  startTest(testName: string): void {
    this.currentTest = {
      testName,
      timestamp: new Date().toISOString(),
      screenshots: [],
      logs: []
    };
  }

  /**
   * Capture a screenshot for the current test
   */
  async captureScreenshot(page: Page, description: string): Promise<string> {
    if (!this.currentTest) {
      throw new Error('No active test for evidence capture');
    }

    const filename = `${this.currentTest.testName}-${Date.now()}-${description.replace(/\s+/g, '-')}.png`;
    const filepath = path.join(this.evidenceDir, filename);
    
    await page.screenshot({ path: filepath });
    this.currentTest.screenshots.push(filename);
    
    return filepath;
  }

  /**
   * Add a log entry for the current test
   */
  addLog(message: string): void {
    if (!this.currentTest) {
      throw new Error('No active test for evidence capture');
    }
    this.currentTest.logs.push(`[${new Date().toISOString()}] ${message}`);
  }

  /**
   * Finalize and save evidence for the current test
   */
  finalizeTest(): void {
    if (!this.currentTest) {
      return;
    }
    
    this.evidence.push(this.currentTest);
    this.currentTest = null;
  }

  /**
   * Save all captured evidence to JSON
   */
  saveReport(): void {
    const reportPath = path.join(this.evidenceDir, 'evidence-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.evidence, null, 2));
  }

  /**
   * Clean up old evidence files
   */
  cleanup(olderThanHours: number = 24): void {
    const now = Date.now();
    const files = fs.readdirSync(this.evidenceDir);
    
    for (const file of files) {
      const filepath = path.join(this.evidenceDir, file);
      const stat = fs.statSync(filepath);
      const ageHours = (now - stat.mtimeMs) / (1000 * 60 * 60);
      
      if (ageHours > olderThanHours) {
        fs.unlinkSync(filepath);
      }
    }
  }
}
