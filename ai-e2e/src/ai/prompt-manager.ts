import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const TEMPLATE_EXTENSION = '.md';
const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

export class PromptTemplateManager {
  private templates: Map<string, string> = new Map();
  private promptsDir: string;

  constructor(promptsDir: string) {
    this.promptsDir = promptsDir;
  }

  async load(templateName: string): Promise<string> {
    const cached = this.templates.get(templateName);
    if (cached !== undefined) {
      return cached;
    }

    const fileName = templateName.endsWith(TEMPLATE_EXTENSION)
      ? templateName
      : `${templateName}${TEMPLATE_EXTENSION}`;

    const filePath = join(this.promptsDir, fileName);
    const content = await readFile(filePath, 'utf-8');
    this.templates.set(templateName, content);
    return content;
  }

  async render(templateName: string, variables: Record<string, string>): Promise<string> {
    const template = await this.load(templateName);

    const requiredVars = new Set<string>();
    let match: RegExpExecArray | null;
    const pattern = new RegExp(VARIABLE_PATTERN.source, 'g');
    while ((match = pattern.exec(template)) !== null) {
      requiredVars.add(match[1]);
    }

    const missing: string[] = [];
    for (const varName of requiredVars) {
      if (!(varName in variables)) {
        missing.push(varName);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing template variables: ${missing.join(', ')}. ` +
        `Required by template "${templateName}": ${[...requiredVars].join(', ')}`,
      );
    }

    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_, varName: string) => variables[varName] ?? `{{${varName}}}`,
    );
  }

  async listTemplates(): Promise<string[]> {
    const files = await readdir(this.promptsDir);
    return files
      .filter((f) => f.endsWith(TEMPLATE_EXTENSION))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
  }
}
