// The menu bar (D197): File, Edit, View, Map, History, Window, Help, drawn from the list of commands.
import { useStore, store } from '../store.ts';
import { TOOLS } from '../tools.ts';
import { MENUS, COMMANDS, OTHER_SHORTCUTS, menuItems } from '../commands.ts';

export function MenuBar() {
  const s = useStore();
  const open = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    store.set({ menu: { x: r.left, y: r.bottom + 2, items: menuItems(id), bar: id } });
  };
  return (
    <div className="menubar-menus" role="menubar">
      {MENUS.map((m) => (
        <button key={m.id} role="menuitem" aria-haspopup="menu" aria-expanded={s.menu?.bar === m.id} className={`menubar-menu ${s.menu?.bar === m.id ? 'open' : ''}`} data-testid={`menu-${m.id}`}
          onClick={(e) => { if (s.menu?.bar === m.id) store.set({ menu: null }); else open(m.id, e.currentTarget); }}
          // (With a menu open, the others open as the pointer passes over them.)
          onPointerEnter={(e) => { if (s.menu?.bar && s.menu.bar !== m.id) open(m.id, e.currentTarget); }}>{m.name}</button>
      ))}
    </div>
  );
}

/** Every shortcut, read from the commands. */
export function ShortcutsDialog() {
  const close = () => store.set({ dialog: null });
  const rows: Array<[string, string]> = [
    ...COMMANDS.filter((c) => c.shortcut).map((c): [string, string] => [c.shortcut!, c.id.startsWith('studio-') ? `Studio: ${c.name}` : c.name.replace(/…$/, '')]),
    ['Ctrl+Shift+Z', 'Redo'],
    ...TOOLS.map((t): [string, string] => [t.key, `Tool: ${t.name}`]),
    ...OTHER_SHORTCUTS,
  ];
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" data-testid="shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <table className="shortcuts"><tbody>
          {rows.map(([k, what]) => <tr key={k + what}><td><kbd>{k}</kbd></td><td>{what}</td></tr>)}
        </tbody></table>
        <div className="modal-actions"><button onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
