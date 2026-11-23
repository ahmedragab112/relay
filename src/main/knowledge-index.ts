import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { KNOWLEDGE_LIBRARY_FILE, formatKnowledgeIndex, parseKnowledgeLibrary } from '../shared/knowledge.js';

const LIBRARY_BYTES = 16 * 1024 * 1024;

/** Compact index of the app-wide Knowledge library, or undefined when nothing is saved. */
export async function loadKnowledgeIndex(directory: string): Promise<string | undefined> {
  if (!directory) return undefined;
  try {
    const path = join(directory, KNOWLEDGE_LIBRARY_FILE);
    const info = await stat(path);
    if (!info.isFile() || info.size > LIBRARY_BYTES) return undefined;
    const sources = parseKnowledgeLibrary(await readFile(path, 'utf8'));
    return sources.length ? formatKnowledgeIndex(sources, directory) : undefined;
  } catch { return undefined; }
}
