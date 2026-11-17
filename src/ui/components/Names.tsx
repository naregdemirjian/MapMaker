// Names over time: a country, city or character can be renamed from a date on (Constantinople
// becomes Istanbul in 1930). Labels on the map use the name in force at each date.
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { fromStore } from '../../core-time/index.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { placementMode } from './Characters.tsx';
import { fmt } from './Panels.tsx';

export function NamesSection({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const ent = w.get('entity', id);
  if (!ent) return null;
  const renames = w.all('effect')
    .filter((f) => f.kind === 'rename' && parseJSON<{ entity?: string } | null>(f.intent, null)?.entity === id)
    .map((f) => ({ f, name: parseJSON<{ name: string }>(f.intent, { name: '' }).name, t: f.at_day === null ? null : fromStore(f.at_day, f.at_ms ?? 0), ev: w.get('event', f.event_id) }))
    .sort((a, b) => (a.t ? (b.t ? a.t.day - b.t.day || a.t.ms - b.t.ms : 1) : -1));
  const now = e.nameAt(id, s.time);
  const rename = async () => {
    const name = await s.askText(`Renamed on ${fmt(s.time)}`, `New name of ${now ?? ent.name} from ${fmt(s.time)} on`, now ?? ent.name, 'Rename');
    if (name) s.execute((wd) => cmd.renameFrom(wd, { entity: id, name, mode: placementMode() }));
  };
  return (
    <div className="names-section">
      <h4>Names over time</h4>
      {now && now !== ent.name && <div className="stat" data-testid="name-now">On {fmt(s.time)}: called <b>{now}</b></div>}
      {renames.map((r) => (
        <div key={r.f.id} className="effect" data-testid="rename-row">
          <div><span className="date">{r.t ? fmt(r.t) : 'From the beginning'}</span> · {r.name}{r.ev && r.ev.id !== 'evt_base' ? <span className="muted"> · {r.ev.name}</span> : null}</div>
          <div className="effect-tools">
            {r.t && <button className="small" onClick={() => s.setTime(r.t!)}>Go to</button>}
            <button className="small danger" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, r.f.id))}>Remove</button>
          </div>
        </div>
      ))}
      <button className="small" onClick={rename} data-testid="rename-from">Renamed on {fmt(s.time)}…</button>
      {!renames.length && <p className="muted">Called {ent.name} throughout. Rename it from a date (the map shows each name in its time).</p>}
    </div>
  );
}
