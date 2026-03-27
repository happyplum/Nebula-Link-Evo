import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

vi.mock('../../browser-client.js', () => ({
  browserClient: {
    screenshot: vi.fn(),
    getSimplifiedDOM: vi.fn(),
  },
}));

describe('FailureSampleCollector', () => {
  let FailureSampleCollector: typeof import('../../services/failure-sample-collector.js').FailureSampleCollector;
  let collector: import('../../services/failure-sample-collector.js').FailureSampleCollector;
  let mockWriteFileSync: any;
  let mockMkdirSync: any;
  let mockExistsSync: any;
  let mockReaddirSync: any;
  let mockRmSync: any;
  let mockBrowserScreenshot: any;
  let mockBrowserGetSimplifiedDOM: any;

  beforeEach(async () => {
    // Get mock functions
    const fs = await import('node:fs');
    const browserClient = await import('../../browser-client.js');

    mockWriteFileSync = vi.mocked(fs.writeFileSync);
    mockMkdirSync = vi.mocked(fs.mkdirSync);
    mockExistsSync = vi.mocked(fs.existsSync);
    mockReaddirSync = vi.mocked(fs.readdirSync);
    mockRmSync = vi.mocked(fs.rmSync);
    mockBrowserScreenshot = vi.mocked(browserClient.browserClient.screenshot);
    mockBrowserGetSimplifiedDOM = vi.mocked(browserClient.browserClient.getSimplifiedDOM);

    vi.clearAllMocks();
    mockExistsSync.mockImplementation((_path: string) => false);
    mockReaddirSync.mockReturnValue([]);
    mockBrowserScreenshot.mockResolvedValue({ screenshot: 'base64screenshotdata' });
    mockBrowserGetSimplifiedDOM.mockResolvedValue({ elements: [] });
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);

    // Reset singleton instance by accessing and clearing it
    FailureSampleCollector = (await import('../../services/failure-sample-collector.js')).FailureSampleCollector;
    (FailureSampleCollector as any).instance = null;
    collector = FailureSampleCollector.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('should return same instance', () => {
      const instance1 = FailureSampleCollector.getInstance();
      const instance2 = FailureSampleCollector.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create instance on first call', () => {
      const instance = FailureSampleCollector.getInstance();

      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(FailureSampleCollector);
    });
  });

  describe('saveFailureSample', () => {
    const mockAction = {
      type: 'click' as const,
      params: { x: 100, y: 200 },
      reasoning: 'Click button',
    };

    const mockError = new Error('Test error message');
    mockError.stack = 'Error: Test error message\n    at test.ts:10:15';

    const mockUrl = 'https://example.com';

    it('should save screenshot, dom, and context', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return !String(path).match(/\.sisyphus[\\/]failures/);
      });

      const result = await collector.saveFailureSample(mockAction, mockError, mockUrl);

      expect(result).toBeTruthy();
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/\.sisyphus[\\/]failures/),
        { recursive: true }
      );
      expect(mockBrowserScreenshot).toHaveBeenCalled();
      expect(mockBrowserGetSimplifiedDOM).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(3); // screenshot, dom, context
    });

    it('should handle screenshot failure gracefully', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return !String(path).match(/\.sisyphus[\\/]failures/);
      });
      mockBrowserScreenshot.mockRejectedValue(new Error('Screenshot failed'));

      const result = await collector.saveFailureSample(mockAction, mockError, mockUrl);

      expect(result).toBeTruthy();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2); // dom and context only
    });

    it('should handle dom failure gracefully', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return !String(path).match(/\.sisyphus[\\/]failures/);
      });
      mockBrowserGetSimplifiedDOM.mockRejectedValue(new Error('DOM failed'));

      const result = await collector.saveFailureSample(mockAction, mockError, mockUrl);

      expect(result).toBeTruthy();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2); // screenshot and context only
    });

    it('should return null on error', async () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      const result = await collector.saveFailureSample(mockAction, mockError, mockUrl);

      expect(result).toBeNull();
    });

    it('should not write screenshot if screenshot data is null', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return !String(path).match(/\.sisyphus[\\/]failures/);
      });
      mockBrowserScreenshot.mockResolvedValue({ screenshot: null });

      await collector.saveFailureSample(mockAction, mockError, mockUrl);

      const writeCalls = mockWriteFileSync.mock.calls;
      const screenshotWrites = writeCalls.filter((call: any[]) =>
        String(call[0]).includes('screenshot.png')
      );
      expect(screenshotWrites).toHaveLength(0);
    });

    it('should call cleanupOldSamples after saving', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (String(path).match(/\.sisyphus[\\/]failures/)) {
          return true;
        }
        return false;
      });
      mockReaddirSync.mockReturnValue(['1234567890', '1234567891']);

      await collector.saveFailureSample(mockAction, mockError, mockUrl);

      expect(mockReaddirSync).toHaveBeenCalledWith(expect.stringMatching(/\.sisyphus[\\/]failures/));
    });

    it('should write correct context data', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return !String(path).match(/\.sisyphus[\\/]failures/);
      });

      await collector.saveFailureSample(mockAction, mockError, mockUrl);

      const writeCalls = mockWriteFileSync.mock.calls;
      const contextWrite = writeCalls.find((call: any[]) =>
        String(call[0]).includes('context.json')
      );

      expect(contextWrite).toBeDefined();
      const context = JSON.parse(String(contextWrite?.[1]));
      expect(context).toHaveProperty('timestamp');
      expect(context).toHaveProperty('url', mockUrl);
      expect(context).toHaveProperty('action', mockAction);
      expect(context).toHaveProperty('error');
      expect(context.error.message).toBe('Test error message');
      expect(context.error.stack).toBe(mockError.stack);
    });
  });

  describe('listSamples', () => {
    it('should return sorted list of samples', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['1000000000', '2000000000', '1500000000']);

      const samples = collector.listSamples();

      expect(samples).toHaveLength(3);
      expect(samples[0].timestamp).toBe(2000000000);
      expect(samples[1].timestamp).toBe(1500000000);
      expect(samples[2].timestamp).toBe(1000000000);
    });

    it('should return empty array if no samples', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const samples = collector.listSamples();

      expect(samples).toEqual([]);
    });

    it('should handle errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Read failed');
      });

      const samples = collector.listSamples();

      expect(samples).toEqual([]);
    });

    it('should return empty array if failures directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const samples = collector.listSamples();

      expect(samples).toEqual([]);
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });

    it('should filter non-numeric directory names', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['1234567890', 'invalid', '9876543210', '.gitkeep']);

      const samples = collector.listSamples();

      expect(samples).toHaveLength(2);
      expect(samples[0].timestamp).toBe(9876543210);
      expect(samples[1].timestamp).toBe(1234567890);
    });

    it('should include full path in sample objects', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['1234567890']);

      const samples = collector.listSamples();

      expect(samples[0].path).toMatch(/\.sisyphus[\\/]failures/);
      expect(samples[0].path).toContain('1234567890');
    });
  });

  describe('cleanupOldSamples (through saveFailureSample)', () => {
    const mockAction = {
      type: 'click' as const,
      params: { x: 100, y: 200 },
      reasoning: 'Click button',
    };

    const mockError = new Error('Test error');
    const mockUrl = 'https://example.com';

    it('should remove old samples exceeding MAX_SAMPLES (50)', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return String(path).match(/\.sisyphus[\\/]failures/) !== null;
      });

      // Create 51 old samples
      const oldSamples: string[] = [];
      for (let i = 1; i <= 51; i++) {
        oldSamples.push(String(Date.now() - i * 1000));
      }
      mockReaddirSync.mockReturnValue(oldSamples);

      await collector.saveFailureSample(mockAction, mockError, mockUrl);

      // Should have removed at least 1 old sample
      expect(mockRmSync).toHaveBeenCalled();
    });

    it('should keep MAX_SAMPLES most recent', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return String(path).match(/\.sisyphus[\\/]failures/) !== null;
      });

      const samples: string[] = [];
      const now = Date.now();
      for (let i = 0; i < 55; i++) {
        samples.push(String(now - i * 1000));
      }
      mockReaddirSync.mockReturnValue(samples);

      await collector.saveFailureSample(mockAction, mockError, mockUrl);

      // Should remove exactly 5 oldest samples (55 total - 50 max = 5 removed)
      expect(mockRmSync).toHaveBeenCalledTimes(5);
    });

    it('should not remove samples if under MAX_SAMPLES', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return String(path).match(/\.sisyphus[\\/]failures/) !== null;
      });
      mockReaddirSync.mockReturnValue(['1000000000', '2000000000', '3000000000']);

      await collector.saveFailureSample(mockAction, mockError, mockUrl);

      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (String(path).match(/\.sisyphus[\\/]failures/) && !String(path).includes(String(Date.now()))) {
          return true;
        }
        return false;
      });
      mockReaddirSync.mockReturnValue(['1000000000', '2000000000', '3000000000']);
      mockRmSync.mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      // Should not throw, just log error
      const result = await collector.saveFailureSample(mockAction, mockError, mockUrl);

      expect(result).toBeTruthy();
    });

    it('should skip cleanup if failures directory does not exist', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return !String(path).match(/\.sisyphus[\\/]failures/);
      });
      mockReaddirSync.mockReturnValue(['1000000000', '2000000000']);

      await collector.saveFailureSample(mockAction, mockError, mockUrl);

      // Only called for new sample directory, not for cleanup
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });
  });
});
