// A map's statistics (D171): numbers kept over time, each known at dates and worked out between them, shown in a
// shot's text boxes and title by name in braces ("{GDP}"), counting as history plays.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { statisticsOf } from '../../world-model/world-settings.ts';
import { fromJSONValue, toJSONValue } from '../../core-time/index.ts';
import { STAT_EASES, STAT_FORMATS, formatStatistic, parseAmount, type Statistic } from '../../presentation/statistics.ts';
import { DateField } from './Panels.tsx';

function AmountField({ value, onCommit, testId }: { value: number; onCommit: (n: number) => void; testId?: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text === null) return; const n = parseAmount(text); if (n !== null) onCommit(n); setText(null); };
  return <input value={text ?? String(value)} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
    title='A number, or with a word: "72 billion", "1.2 trillion", "300k"' data-testid={testId} className={text !== null && parseAmount(text) === null ? 'bad' : ''} />;
}

export function StatisticsDialog() {
  const s = useStore();
  const space = s.world!.get('map_space', s.spaceId)!;
  const [draft, setDraft] = useState<Statistic[]>(() => statisticsOf(space));
  const [error, setError] = useState('');
  const close = () => s.set({ dialog: null });
  const put = (i: number, patch: Partial<Statistic>) => setDraft(draft.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = () => {
    const names = draft.map((x) => x.name.trim().toLowerCase());
    if (names.some((n) => !n)) { setError('Give every statistic a name.'); return; }
    if (names.includes('date')) { setError('"date" already shows the date: give the statistic another name.'); return; }
    const twice = names.find((n, i) => names.indexOf(n) !== i);
    if (twice) { setError(`Two statistics are called "${twice}".`); return; }
    s.execute((wd) => cmd.setMapStatistics(wd, space.id, draft));
    close();
  };
  const now = () => toJSONValue(s.time) as [number, number];
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-label="Statistics" data-testid="statistics-dialog">
        <div className="modal-head"><h2>Statistics of “{space.name}”</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">Numbers kept over time: an economy, an army, the dead of a war. Give each its values at dates; between them it is worked out. In a shot's text box or title, write its name in braces, such as {'{GDP}'}, and it counts as history plays.</p>
        {draft.map((st, i) => (
          <div key={i} className="stat-editor" data-testid={`statistic-${i}`}>
            <div className="row">
              <label>Name<input value={st.name} onChange={(e) => put(i, { name: e.target.value })} data-testid={`statistic-name-${i}`} /></label>
              <label>Written as<select value={st.format} onChange={(e) => put(i, { format: e.target.value as Statistic['format'] })}>{STAT_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
              <label>Between dates<select value={st.ease} onChange={(e) => put(i, { ease: e.target.value as Statistic['ease'] })}>{STAT_EASES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
              <button className="link" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Remove</button>
            </div>
            <table className="stat-keys"><tbody>
              {st.keys.map((k, j) => (
                <tr key={`${k.at[0]}:${k.at[1]}:${j}`}>
                  <td><DateField value={fromJSONValue(k.at)} onChange={(t) => t && put(i, { keys: st.keys.map((x, m) => (m === j ? { ...x, at: toJSONValue(t) as [number, number] } : x)).sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]) })} /></td>
                  <td><AmountField value={k.value} onCommit={(n) => put(i, { keys: st.keys.map((x, m) => (m === j ? { ...x, value: n } : x)) })} testId={`statistic-${i}-value-${j}`} /></td>
                  <td className="muted">{formatStatistic(k.value, st.format, st.decimals)}</td>
                  <td><button className="link" onClick={() => put(i, { keys: st.keys.filter((_, m) => m !== j) })}>Remove</button></td>
                </tr>
              ))}
            </tbody></table>
            <button className="small" onClick={() => put(i, { keys: [...st.keys, { at: now(), value: st.keys.length ? st.keys[st.keys.length - 1].value : 0 }].sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]) })} data-testid={`statistic-add-value-${i}`}>+ Value at the date viewed</button>
          </div>
        ))}
        <button onClick={() => setDraft([...draft, { name: `Statistic ${draft.length + 1}`, format: 'number', ease: 'linear', keys: [{ at: now(), value: 0 }] }])} data-testid="statistic-add">+ Statistic</button>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={save} data-testid="statistics-save">Save</button></div>
      </div>
    </div>
  );
}
