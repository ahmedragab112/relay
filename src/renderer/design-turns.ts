import type { ToolPart } from '../shared/contracts';

const EDIT_TOOLS = /^(edit|write|multiedit|multi-edit|patch|apply_patch)$/i;

/** Files the agent wrote or edited, in the order the tools ran, once each. */
export function editedFiles(parts: readonly ToolPart[]): string[] {
  const paths: string[] = [];
  for (const part of parts) {
    if (part.type !== 'tool' || !EDIT_TOOLS.test(part.name)) continue;
    const path = toolPath(part.input);
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

function toolPath(input: string): string | undefined {
  let value: unknown;
  try { value = JSON.parse(input); } catch { return undefined; }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['filePath', 'file_path', 'path']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}
