import { describe, it, expect, beforeAll } from 'vitest';
import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  TaskRequestSchema,
  ActionSchema,
  TaskResponseSchema,
  type TaskRequest,
  type Action,
  type TaskResponse,
} from '../../schemas/task.js';

// Register URI format validator for TypeBox
FormatRegistry.Set('uri', (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
});

describe('TaskRequestSchema', () => {
  it('should validate valid task request', () => {
    const validData = {
      url: 'https://example.com',
      instruction: 'click login button',
    };
    const isValid = Value.Check(TaskRequestSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate task request with context', () => {
    const validData = {
      url: 'https://example.com',
      instruction: 'click login button',
      context: {
        maxSteps: 20,
        previousActions: [],
      },
    };
    const isValid = Value.Check(TaskRequestSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate task request with partial context', () => {
    const validData = {
      url: 'https://example.com',
      instruction: 'click login button',
      context: {
        maxSteps: 15,
      },
    };
    const isValid = Value.Check(TaskRequestSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should reject invalid URL format', () => {
    const invalidData = {
      url: 'not-a-url',
      instruction: 'click login button',
    };
    const isValid = Value.Check(TaskRequestSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject missing url', () => {
    const invalidData = {
      instruction: 'click login button',
    };
    const isValid = Value.Check(TaskRequestSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject missing instruction', () => {
    const invalidData = {
      url: 'https://example.com',
    };
    const isValid = Value.Check(TaskRequestSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for url', () => {
    const invalidData = {
      url: 123,
      instruction: 'click login button',
    };
    const isValid = Value.Check(TaskRequestSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for instruction', () => {
    const invalidData = {
      url: 'https://example.com',
      instruction: 123,
    };
    const isValid = Value.Check(TaskRequestSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for context', () => {
    const invalidData = {
      url: 'https://example.com',
      instruction: 'click login button',
      context: 'invalid',
    };
    const isValid = Value.Check(TaskRequestSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject invalid context properties', () => {
    const invalidData = {
      url: 'https://example.com',
      instruction: 'click login button',
      context: {
        maxSteps: 'invalid',
      },
    };
    const isValid = Value.Check(TaskRequestSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should export TaskRequest type', () => {
    const data: TaskRequest = {
      url: 'https://example.com',
      instruction: 'test',
    };
    expect(data.url).toBe('https://example.com');
    expect(data.instruction).toBe('test');
  });
});

describe('ActionSchema', () => {
  it('should validate valid action', () => {
    const validData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
      },
      success: true,
    };
    const isValid = Value.Check(ActionSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate action with reasoning', () => {
    const validData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
        reasoning: 'Click login button',
      },
      success: true,
    };
    const isValid = Value.Check(ActionSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate action with message', () => {
    const validData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
      },
      success: true,
      message: 'Clicked successfully',
    };
    const isValid = Value.Check(ActionSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate action with failure', () => {
    const validData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
      },
      success: false,
      message: 'Element not found',
    };
    const isValid = Value.Check(ActionSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate action with empty params', () => {
    const validData = {
      action: {
        type: 'finish',
        params: {},
      },
      success: true,
    };
    const isValid = Value.Check(ActionSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should reject missing action', () => {
    const invalidData = {
      success: true,
    };
    const isValid = Value.Check(ActionSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject missing success', () => {
    const invalidData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
      },
    };
    const isValid = Value.Check(ActionSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for success', () => {
    const invalidData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
      },
      success: 'true',
    };
    const isValid = Value.Check(ActionSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for action.type', () => {
    const invalidData = {
      action: {
        type: 123,
        params: { x: 100, y: 200 },
      },
      success: true,
    };
    const isValid = Value.Check(ActionSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for action.params', () => {
    const invalidData = {
      action: {
        type: 'click',
        params: 'invalid',
      },
      success: true,
    };
    const isValid = Value.Check(ActionSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for action.reasoning', () => {
    const invalidData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
        reasoning: 123,
      },
      success: true,
    };
    const isValid = Value.Check(ActionSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for message', () => {
    const invalidData = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
      },
      success: true,
      message: 123,
    };
    const isValid = Value.Check(ActionSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should export Action type', () => {
    const data: Action = {
      action: {
        type: 'click',
        params: { x: 100, y: 200 },
      },
      success: true,
    };
    expect(data.action.type).toBe('click');
    expect(data.success).toBe(true);
  });
});

describe('TaskResponseSchema', () => {
  it('should validate valid task response', () => {
    const validData = {
      success: true,
      url: 'https://example.com',
      actions: [],
    };
    const isValid = Value.Check(TaskResponseSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate task response with actions', () => {
    const validData = {
      success: true,
      url: 'https://example.com',
      actions: [
        {
          action: {
            type: 'click',
            params: { x: 100, y: 200 },
          },
          success: true,
        },
        {
          action: {
            type: 'type',
            params: { selector: '#input', text: 'test' },
          },
          success: true,
        },
      ],
    };
    const isValid = Value.Check(TaskResponseSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate task response with result', () => {
    const validData = {
      success: true,
      url: 'https://example.com',
      actions: [],
      result: 'Task completed successfully',
    };
    const isValid = Value.Check(TaskResponseSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should validate failed task response', () => {
    const validData = {
      success: false,
      url: 'https://example.com',
      actions: [],
      result: 'Task failed',
    };
    const isValid = Value.Check(TaskResponseSchema, validData);
    expect(isValid).toBe(true);
  });

  it('should reject missing success', () => {
    const invalidData = {
      url: 'https://example.com',
      actions: [],
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject missing url', () => {
    const invalidData = {
      success: true,
      actions: [],
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject missing actions', () => {
    const invalidData = {
      success: true,
      url: 'https://example.com',
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for success', () => {
    const invalidData = {
      success: 'true',
      url: 'https://example.com',
      actions: [],
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for url', () => {
    const invalidData = {
      success: true,
      url: 123,
      actions: [],
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for actions', () => {
    const invalidData = {
      success: true,
      url: 'https://example.com',
      actions: 'invalid',
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject wrong type for result', () => {
    const invalidData = {
      success: true,
      url: 'https://example.com',
      actions: [],
      result: 123,
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should reject invalid action in actions array', () => {
    const invalidData = {
      success: true,
      url: 'https://example.com',
      actions: [
        {
          action: 'invalid',
        },
      ],
    };
    const isValid = Value.Check(TaskResponseSchema, invalidData);
    expect(isValid).toBe(false);
  });

  it('should export TaskResponse type', () => {
    const data: TaskResponse = {
      success: true,
      url: 'https://example.com',
      actions: [],
    };
    expect(data.success).toBe(true);
    expect(data.url).toBe('https://example.com');
    expect(data.actions).toEqual([]);
  });
});
