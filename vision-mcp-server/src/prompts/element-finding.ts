import type { ElementLocator } from '@nebula-link-evo/shared';

/**
 * Build a formatted element context string from elements_map.
 * Format: [ID] <tag> "text" @ (x,y,w,h) — one line per element.
 * Only include elements that have an id. Sorted by numeric id.
 */
export function buildElementsContext(elementsMap: Record<string, ElementLocator>): string {
  const entries = Object.values(elementsMap).filter((el) => el.id);

  entries.sort((a, b) => {
    const numA = parseInt(a.id, 10);
    const numB = parseInt(b.id, 10);
    if (Number.isNaN(numA) && Number.isNaN(numB)) return a.id.localeCompare(b.id);
    if (Number.isNaN(numA)) return 1;
    if (Number.isNaN(numB)) return -1;
    return numA - numB;
  });

  return entries
    .map((el) => {
      const textPart = el.text ? ` "${el.text}"` : '';
      const { x, y, width, height } = el.bbox;
      return `[${el.id}] <${el.tag}>${textPart} @ (${x},${y},${width},${height})`;
    })
    .join('\n');
}

/**
 * Build the complete user prompt for the vision model.
 * Combines system instructions, element context, and target description.
 */
export function buildFindingPrompt(elementsContext: string, description: string): string {
  return [
    'You are a web page element matcher. You see an annotated screenshot with red ID labels on interactive elements.',
    '',
    'Here are all the labeled elements:',
    elementsContext,
    '',
    `Find the element matching this description: "${description}"`,
    '',
    'Respond ONLY with a JSON object (no markdown, no extra text):',
    '{ "nebula_id": "<id>", "confidence": <0-1>, "reasoning": "<brief explanation>" }',
    '',
    'If no element matches, respond with:',
    '{ "nebula_id": null, "confidence": 0, "reasoning": "<why no match>" }',
  ].join('\n');
}
