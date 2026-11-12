import type { SkillLibraryEntry, SkillPreview } from '../shared/contracts';
import { button, el } from './dom';
import { dialog } from './dialog';

type Installed = (library: SkillLibraryEntry[]) => void | Promise<void>;

function host(source: string): string {
  try { return new URL(source).host; } catch { return 'this Mac'; }
}

export function showSkillPreview(preview: SkillPreview, onInstalled?: Installed): void {
  const title = preview.skills.length === 1 ? `Install ${preview.skills[0].name}` : `Install ${preview.skills.length} skills`;
  const installer = dialog(title);
  for (const item of preview.skills) {
    const row = el('div', 'row row-identity');
    row.append(el('strong', '', item.name));
    if (item.existing) row.append(el('span', 'pill', 'Updates installed'));
    installer.add(row, el('p', '', item.description || 'No description'));
  }
  const files = el('details', 'skill-files');
  files.append(el('summary', '', `${preview.files.length} file${preview.files.length === 1 ? '' : 's'} · from ${host(preview.source)}`));
  const list = el('ul');
  for (const file of preview.files.slice(0, 40)) list.append(el('li', '', `${file.path} · ${file.size} B`));
  if (preview.files.length > 40) list.append(el('li', '', `and ${preview.files.length - 40} more`));
  files.append(list);
  installer.add(files, el('p', 'plugin-digest', `SHA-256 ${preview.digest}`));
  let consumed = false;
  installer.root.addEventListener('close', () => {
    if (!consumed) void window.relay.cancelSkillPreview(preview.token).catch(() => undefined);
  }, { once: true });
  const actions = el('div', 'dialog-actions');
  const cancel = button('Cancel', () => installer.root.close());
  const install = button(preview.skills.some(item => item.existing) ? 'Update skills' : 'Install skills', async () => {
    installer.busy(true);
    try {
      const library = await window.relay.installSkills(preview.token);
      consumed = true;
      installer.root.close();
      await onInstalled?.(library);
    } catch (error) { installer.fail(error); }
    finally { installer.busy(false); }
  }, 'button primary');
  cancel.type = 'button'; install.type = 'button';
  actions.append(cancel, install);
  installer.add(actions);
}

export function installSkillFromURL(url: string, sha256: string | undefined, onInstalled?: Installed): void {
  const previewing = dialog('Previewing skill');
  previewing.busy(true);
  previewing.add(el('p', '', 'Downloading the skill and checking its files before anything is installed.'));
  void window.relay.previewSkillFromURL(url, sha256).then((preview) => {
    previewing.root.close();
    showSkillPreview(preview, onInstalled);
  }).catch((error) => {
    previewing.fail(error);
    previewing.busy(false);
    const actions = el('div', 'dialog-actions');
    const close = button('Close', () => previewing.root.close());
    close.type = 'button';
    actions.append(close);
    previewing.add(actions);
  });
}
