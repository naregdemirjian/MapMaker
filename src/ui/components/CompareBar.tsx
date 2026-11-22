// Comparing (Stage 3, D150): the other side's date (or the date viewed, as it moves) and timeline, the two
// swapped, and side by side or across a line. Over the map, beside what it controls.
import { useStore } from '../store.ts';
import { branchTree, branchName } from '../../temporal-engine/branches.ts';
import { DateField } from '../inputs.tsx';

export function CompareBar() {
  const s = useStore();
  const w = s.world!;
  const c = s.compare;
  const set = (patch: Partial<typeof c>) => s.set({ compare: { ...c, ...patch } });
  return (
    <div className="compare-bar" data-testid="compare-bar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="muted">{c.side ? 'Beside it:' : 'Right of the line:'}</span>
      {w.all('branch').length > 0 && (
        <select className="compare-branch" value={c.branch ?? ''} data-testid="compare-branch"
          title="Compare with another timeline (D150): the main timeline or a branch, at the same date unless you choose another"
          onChange={(e) => { const b = e.target.value || undefined; set({ branch: b, same: !!b }); }}>
          <option value="">This timeline</option>
          {branchTree(w).filter((b) => b.id !== s.branch).map((b) => <option key={b.id} value={b.id}>{branchName(w, b.id)}</option>)}
        </select>
      )}
      {c.same
        ? <button onClick={() => set({ same: false, time: s.time })} title="The other side shows the date viewed, as it moves: click to choose another date" data-testid="compare-same">Same date</button>
        : <DateField value={c.time} onChange={(t) => t && set({ time: t })} testId="compare-date" />}
      {!c.same && <button onClick={() => { const a = s.time; s.setTime(c.time); set({ time: a }); }} title="Swap the two dates" data-testid="compare-swap">⇄</button>}
      <button className={c.side ? 'on' : ''} onClick={() => set({ side: !c.side })} aria-label={c.side ? 'Side by side' : 'Across a line'}
        title={c.side ? 'Side by side: the same place twice, next to each other. Click to compare across a line instead' : 'Across a line you drag. Click to see the two side by side instead'} data-testid="compare-side">{c.side ? '◫ Side by side' : '⇹ Across a line'}</button>
      <button className="close" onClick={() => set({ on: false })} aria-label="Stop comparing" title="Stop comparing">×</button>
    </div>
  );
}
