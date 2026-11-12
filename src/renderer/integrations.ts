import { dialog } from './dialog';
import { button, el } from './dom';

export function showAgents(): void {
  const modal = dialog('Agents');
  const list = el('div');
  modal.add(el('p', '', 'Agents available in this workspace. Tool agents inherit the task model; only the task composer selects a model.'), list);
  const load = async () => {
    list.replaceChildren(el('p', '', 'Loading agents…'));
    try {
      const agents = await window.relay.listAgents();
      if (!modal.root.isConnected) return;
      list.replaceChildren(...agents.map(agent => {
        const row = el('section', 'integration-row');
        const header = el('div', 'row');
        header.append(el('strong', '', agent.name), el('span', 'pill', agent.primary ? 'Primary' : 'Tool agent'));
        row.append(header, el('p', '', agent.description));
        return row;
      }));
      if (!agents.length) list.append(el('p', '', 'No agents are available. Check that the engine is ready.'));
    } catch (error) { list.replaceChildren(button('Retry loading agents', load)); modal.fail(error); }
  };
  void load();
}
