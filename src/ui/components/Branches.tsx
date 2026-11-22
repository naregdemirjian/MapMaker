// Branches in the interface (Stage 13, D150): the timeline viewed, switched from the title bar; the Branches
// dialog that makes a branch from the date viewed and renames, recolours, moves or deletes branches.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { MAIN_BRANCH, isBaseEvent } from '../../world-model/schema.ts';
import { branchTree, branchName, branchStart, branchAndBelow } from '../../temporal-engine/branches.ts';
import { fromStore, type Instant } from '../../core-time/index.ts';
import { DateField } from '../inputs.tsx';
import { calendarNow } from '../calendar-now.ts';

const indent = (depth: number) => '   '.repeat(depth);

/** The timeline viewed, in the title bar: a list of the main timeline and its branches, and the Branches dialog. */
export function BranchSwitcher() {
  const s = useStore();
  const w = s.world!;
  const tree = branchTree(w);
  const row = s.branch !== MAIN_BRANCH ? w.get('branch', s.branch) : null;
  return (
    <span className="branch-switch" data-testid="branch-switch">
      {tree.length > 1 && (
        <select value={s.branch} onChange={(e) => s.setBranch(e.target.value)} style={row ? { borderLeft: `4px solid ${row.color}` } : undefined}
          title="Which timeline you are looking at and drawing in: the main timeline or one of its branches (alternative histories)" data-testid="branch-select">
          {tree.map((b) => <option key={b.id} value={b.id}>{indent(b.depth)}{branchName(w, b.id)}</option>)}
        </select>
      )}
      <button className="icon-button" onClick={() => s.set({ dialog: 'branches' })} data-testid="open-branches" aria-label="Branches"
        title="Branches: an alternative history that splits off at the date viewed, shares everything before it and has its own events after it">⑂</button>
    </span>
  );
}

/** Making, changing and deleting branches. */
export function BranchesDialog() {
  const s = useStore();
  const w = s.world!;
  const cal = calendarNow();
  const tree = branchTree(w);
  const [name, setName] = useState(`Branch ${w.all('branch').length + 1}`);
  const [from, setFrom] = useState<Instant>(s.time);
  const [parent, setParent] = useState<string>(s.branch);
  const [editing, setEditing] = useState<string | null>(null);
  const close = () => s.set({ dialog: null });
  const make = () => {
    const id = s.execute((wd) => cmd.createBranch(wd, { name, from, parent }));
    if (id) { s.setBranch(id); close(); s.toast(`Now viewing the branch "${name.trim()}": what you draw from ${cal.format(from, 'day')} on is its own.`); }
  };
  const own = (id: string) => w.all('event').filter((e) => e.branch_id === id && !isBaseEvent(e.id)).length;
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal wide branches-dialog" role="dialog" aria-label="Branches" data-testid="branches-dialog">
        <div className="modal-head"><h2>Branches</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">A branch is an alternative history. It splits off at a date: everything before then it shares with the timeline it comes from, live (fixing early history fixes both), and after it, it has events of its own. Countries, cities and characters are shared by every branch.</p>
        <div className="branch-list">
          {tree.map((b) => {
            const r = b.row;
            const sel = b.id === s.branch;
            return (
              <div key={b.id} className={`branch-row ${sel ? 'sel' : ''}`} data-testid={`branch-row-${branchName(w, b.id)}`}>
                <div className="branch-line">
                  <span style={{ paddingLeft: `${b.depth * 16}px` }} />
                  <span className="swatch" style={{ background: r ? r.color : '#9aa7b4' }} />
                  <b>{branchName(w, b.id)}</b>
                  <span className="muted">{r ? ` · splits from ${branchName(w, r.parent_id)} on ${cal.format(branchStart(r), 'day')} · ${own(b.id)} event${own(b.id) === 1 ? '' : 's'} of its own` : ' · the history every branch starts from'}</span>
                  <span className="row-tools">
                    {!sel && <button className="small" onClick={() => { s.setBranch(b.id); close(); }} data-testid={`branch-view-${branchName(w, b.id)}`}>View</button>}
                    {sel && <span className="muted">viewing</span>}
                    {r && <button className="small" onClick={() => setEditing(editing === b.id ? null : b.id)} data-testid={`branch-edit-${r.name}`}>Edit…</button>}
                    {r && <button className="small danger" onClick={() => {
                      const below = branchAndBelow(w, b.id).size - 1;
                      const events = w.all('event').filter((e) => branchAndBelow(w, b.id).has(e.branch_id) && !isBaseEvent(e.id)).length;
                      if (!confirm(`Delete the branch "${r.name}"${below ? ` and the ${below} branch${below === 1 ? '' : 'es'} that split from it` : ''}, with ${events} event${events === 1 ? '' : 's'} of ${below ? 'their' : 'its'} own? What it shares with ${branchName(w, r.parent_id)} stays. Undo brings it back.`)) return;
                      s.execute((wd) => cmd.deleteBranch(wd, b.id));
                    }} data-testid={`branch-delete-${r.name}`}>Delete</button>}
                  </span>
                </div>
                {r && editing === b.id && <BranchEditor id={b.id} onDone={() => setEditing(null)} />}
              </div>
            );
          })}
        </div>
        <h3>New branch</h3>
        <div className="branch-new">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') make(); }} data-testid="new-branch-name" /></label>
          <label title="The timeline it splits from">From
            <select value={parent} onChange={(e) => setParent(e.target.value)} data-testid="new-branch-parent">
              {tree.map((b) => <option key={b.id} value={b.id}>{indent(b.depth)}{branchName(w, b.id)}</option>)}
            </select>
          </label>
          <label title="Everything up to and including this moment is shared; from it on, the branch has its own history">Splits off on
            <DateField value={from} onChange={(t) => t && setFrom(t)} testId="new-branch-date" />
          </label>
        </div>
        <div className="modal-actions">
          <button onClick={close}>Close</button>
          <button className="primary" onClick={make} data-testid="new-branch-make">Make the branch and view it</button>
        </div>
      </div>
    </div>
  );
}

/** A branch's name, colour, notes and the moment it splits off. */
function BranchEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const s = useStore();
  const r = s.world!.get('branch', id)!;
  const [name, setName] = useState(r.name);
  const [color, setColor] = useState(r.color);
  const [notes, setNotes] = useState(r.notes);
  const [from, setFrom] = useState<Instant>(fromStore(r.from_day, r.from_ms));
  const save = () => {
    const moved = from.day !== r.from_day || from.ms !== r.from_ms;
    const ok = s.execute((wd) => cmd.updateBranch(wd, id, { name, color, notes, ...(moved ? { from } : {}) }));
    if (ok !== undefined) onDone();
  };
  return (
    <div className="branch-editor" data-testid="branch-editor">
      <div className="two">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} data-testid="branch-name-edit" /></label>
        <label>Colour<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      </div>
      <label title="Moving it changes what the branch shares with the timeline it comes from, at once">Splits off on
        <DateField value={from} onChange={(t) => t && setFrom(t)} testId="branch-date-edit" />
      </label>
      <label>Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="row-inline">
        <button className="small" onClick={onDone}>Cancel</button>
        <button className="small primary" onClick={save} data-testid="branch-save">Save</button>
      </div>
    </div>
  );
}
