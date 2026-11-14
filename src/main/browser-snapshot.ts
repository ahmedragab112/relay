/** Pure accessibility-tree rendering for browser snapshots: no Electron imports. */

export interface A11yNode {
  nodeId: string;
  ignored?: boolean;
  role?: { type?: string; value?: unknown };
  name?: { type?: string; value?: unknown };
  properties?: Array<{ name: string; value: { type?: string; value?: unknown } }>;
  childIds?: string[];
  backendDOMNodeId?: number;
}

export interface SnapshotRenderOptions {
  /** Maximum walk depth; the protocol default is 8. */
  depth?: number;
  /** When set, only lines containing this text (case-insensitive) are kept. */
  find?: string;
  /** Walk starts from this node instead of the first; used to snapshot one element's subtree. */
  rootNodeId?: string;
}

export interface SnapshotRender {
  content: string;
  truncated: boolean;
  /** Snapshot ref (`e1`) → CDP backend node id, for click/fill targeting. */
  refs: Map<string, number>;
}

/** The engine rejects result values over this size; keep snapshots at the protocol cap. */
export const MAX_TEXT = 100_000;
const MAX_LINES = 500;
const ACTIONABLE = /^(button|link|textbox|combobox|checkbox|radio|option)$/;

/**
 * Renders a CDP accessibility tree as aria-style lines:
 *
 *   - RootWebArea "Example"
 *     - heading "Welcome" [level=1]
 *     - text "Hello world"
 *     - button "Submit" [ref=e1]
 *
 * Refs are handed out in document order to actionable elements and returned in
 * `refs` so the caller can target clicks/fills by ref.
 */
export function renderA11ySnapshot(nodes: A11yNode[], options: SnapshotRenderOptions = {}): SnapshotRender {
  const depth = options.depth ?? 8;
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const refs = new Map<string, number>();
  const lines: string[] = [];
  let next = 0;
  let truncated = false;

  let root = options.rootNodeId ? byId.get(options.rootNodeId) : nodes[0];
  if (!root) return { content: '', truncated: false, refs };

  const walk = (node: A11yNode, level: number): void => {
    if (level > depth || lines.length >= MAX_LINES) {
      truncated = true;
      return;
    }

    const role = String(node.role?.value ?? 'node');
    const properties = new Map((node.properties ?? []).map((property) => [property.name, property.value.value]));
    const name = collapse(String(node.name?.value ?? ''));
    const shownRole = role === 'StaticText' ? 'text' : role;

    let line = `${'  '.repeat(level)}- ${shownRole}`;
    if (name) line += ` ${JSON.stringify(name)}`;
    if (role === 'heading' && properties.has('level')) line += ` [level=${properties.get('level')}]`;
    if (properties.has('checked')) {
      const checked = properties.get('checked');
      line += checked === true ? ' [checked]' : checked === 'mixed' ? ' [checked=mixed]' : '';
    }
    for (const flag of ['disabled', 'expanded', 'selected'] as const) {
      if (properties.get(flag) === true) line += ` [${flag}]`;
    }

    if (!node.ignored) {
      const actionable = role !== 'RootWebArea' && (properties.get('focusable') === true || ACTIONABLE.test(role));
      if (actionable && typeof node.backendDOMNodeId === 'number') {
        const ref = `e${++next}`;
        refs.set(ref, node.backendDOMNodeId);
        line += ` [ref=${ref}]`;
      }
      lines.push(line);
    }

    if (role === 'textbox' || role === 'searchbox' || properties.get('editable') === true) return;
    for (const childID of node.childIds ?? []) {
      const child = byId.get(childID);
      if (child) walk(child, level + 1);
    }
  };

  walk(root, 0);

  const selected = options.find ? lines.filter((line) => line.toLowerCase().includes(options.find!.toLowerCase())) : lines;
  const joined = selected.join('\n').slice(0, MAX_TEXT);
  return { content: joined, truncated: truncated || joined.length >= MAX_TEXT || selected.length !== lines.length, refs };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}
