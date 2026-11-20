// Colour countries by closeness (D174): how close each of today's countries is to one of the map's, militarily,
// economically, religiously, by language or overall; their own colours kept and back in one step.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { colourByOfSpace } from '../../world-model/world-settings.ts';
import { AFFINITY_KINDS, affinity, affinityWhy, closenessColour, RAMP_STOPS, FOCUS_COLOUR, type AffinityKind } from '../../domain/affinity.ts';

export function ColourByDialog() {
  const s = useStore();
  const w = s.world!;
  const space = w.get('map_space', s.spaceId)!;
  const cur = colourByOfSpace(space);
  const countries = w.all('entity').filter((e) => e.type_id === 'polity' || e.type_id === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const [kind, setKind] = useState<AffinityKind>(cur?.kind ?? 'military');
  const sel = s.selection?.kind === 'entity' ? s.selection.id : null;
  const [focus, setFocus] = useState(cur?.focus ?? (sel && countries.some((c) => c.id === sel) ? sel : countries.find((c) => c.name === 'Armenia')?.id ?? countries[0]?.id ?? ''));
  const [legend, setLegend] = useState(cur?.legend ?? true);
  const close = () => s.set({ dialog: null });
  const f = countries.find((c) => c.id === focus);
  const ranked = f ? countries.filter((c) => c.id !== f.id).map((c) => ({ c, v: affinity(f.name, c.name, kind) })).filter((x) => x.v !== null && x.v > 0).sort((a, b) => b.v! - a.v!).slice(0, 12) : [];
  return (
    <div className="modal-back" onPointerDown={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-label="Colour countries by closeness" data-testid="colour-by-dialog">
        <div className="modal-head"><h2>Colour countries by closeness</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">Each of today's countries is coloured by how close it is to one country: the alliances, economic blocs, religion or language they share, as of 2026. Countries of your own making are grey. Their own colours are kept: turn this off to see them again. Shots show it too, with a legend.</p>
        <label>Close to<select value={focus} onChange={(e) => setFocus(e.target.value)} data-testid="colour-by-focus">{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <div className="colour-by-kinds">
          {AFFINITY_KINDS.map((k) => (
            <label key={k.id} className="check" title={k.about}><input type="radio" checked={kind === k.id} onChange={() => setKind(k.id)} data-testid={`colour-by-${k.id}`} /> {k.name} <span className="muted">· {k.about}</span></label>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={legend} onChange={(e) => setLegend(e.target.checked)} data-testid="colour-by-legend" /> A legend in shots</label>
        <div className="colour-by-ramp"><span className="swatch" style={{ background: FOCUS_COLOUR }} /> {f?.name ?? ''} <span className="ramp" style={{ background: `linear-gradient(to right, ${RAMP_STOPS.join(', ')})` }} /> <span className="muted">nothing shared → closest</span></div>
        {f && <table className="colour-by-list" data-testid="colour-by-list"><tbody>
          {ranked.map(({ c, v }) => (
            <tr key={c.id}><td><span className="swatch" style={{ background: closenessColour(v!) }} /></td><td>{c.name}</td><td>{Math.round(v! * 100)} %</td><td className="muted">{affinityWhy(f.name, c.name, kind).slice(0, 3).join('; ')}</td></tr>
          ))}
          {!ranked.length && <tr><td className="muted">Nothing is known of {f.name}'s ties: only today's countries, by their names, are.</td></tr>}
        </tbody></table>}
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          {cur && <button onClick={() => { s.execute((wd) => cmd.setColourBy(wd, space.id, null)); close(); }} data-testid="colour-by-off">Their own colours</button>}
          <button className="primary" disabled={!f} onClick={() => { s.execute((wd) => cmd.setColourBy(wd, space.id, { kind, focus, legend })); close(); }} data-testid="colour-by-apply">Colour the map</button>
        </div>
      </div>
    </div>
  );
}
