// A group of Properties that folds (D200). Whether a group is folded is remembered by its name for the kind
// of thing shown (fold a country's Relationships and it stays folded for every country), with the project's view.
import { useStore } from '../store.ts';

export function PropGroup({ id, title, children, folded = false }: { id: string; title: string; children: React.ReactNode; folded?: boolean }) {
  const s = useStore();
  // (A group that starts folded remembers being opened; one that starts open, being folded.)
  const key = `prop:${id}`, toggled = s.collapsed.includes(key), open = folded ? toggled : !toggled;
  return (
    <section className={`prop-group ${open ? 'open' : ''}`} data-testid={`group-${id}`}>
      <button className="prop-head" aria-expanded={open} onClick={() => s.toggleCollapsed(key)} data-testid={`group-head-${id}`}><span className="twisty" aria-hidden="true">{open ? '▾' : '▸'}</span>{title}</button>
      {open && <div className="prop-body">{children}</div>}
    </section>
  );
}
