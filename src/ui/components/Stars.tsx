// A star's panel on a space map (Stage 11, D110): what it is, how far, its system.
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { isBaseEvent } from '../../world-model/schema.ts';
import { fmt } from './Panels.tsx';
import { placementMode } from './Characters.tsx';
import { starColour, starKind, galacticOf, systemOf } from '../../space/catalogue.ts';
import { exoplanetsNow, foundBy, planetSize } from '../../space/exoplanets.ts';
import { spaceScene } from '../../space/scene.ts';
import { BODIES, MOONS, orbitalYears } from '../../space/solar.ts';
import { spaceSettingsOf } from '../../world-model/world-settings.ts';

export function StarPanel({ id }: { id: number }) {
  const s = useStore();
  const scene = spaceScene(spaceSettingsOf(s.world?.get('map_space', s.spaceId)), s.time, () => s.notify());
  const cat = scene.cat, solar = scene.unit === 'au', galaxy = !!scene.middle;
  const st = cat?.byId.get(id);
  const body = solar ? BODIES.find((b) => b.id === id) : undefined;
  const moon = solar ? MOONS.find((m) => m.id === id) : undefined;
  if (!cat || !st) return <div className="panel"><p className="muted">Loading the stars…</p></div>;
  const system = systemOf(cat, id).map((x) => cat.byId.get(x)!);
  // (Planets of other stars, D118: the nearby star map only.)
  const known = !solar && !galaxy && spaceSettingsOf(s.world?.get('map_space', s.spaceId))?.catalogue === 'nearby' ? exoplanetsNow(() => s.notify())?.byStar.get(id) ?? [] : [];
  const g = galacticOf(st.x, st.y, st.z);
  const holderId = s.engine?.systemsAt(s.spaceId, s.time).get(id);
  const holder = holderId ? s.world!.get('entity', holderId) ?? null : null;
  const steps = s.engine ? s.engine.systemSteps(s.spaceId, id) : [];
  const lanes = s.engine ? s.engine.lanesAt(s.spaceId, s.time).filter((l) => l.a === id || l.b === id) : [];
  return (
    <div className="panel" data-testid="star-panel">
      <h3><span className="swatch big" style={{ background: st.color ?? (st.id === 0 ? '#fff1c9' : starColour(st.spect)) }} /> <span data-testid="star-name">{st.name}</span></h3>
      {st.alt && <div className="muted">{st.alt}</div>}
      {galaxy ? <table className="facts"><tbody>
        <tr><td>Kind</td><td data-testid="star-kind">{st.kind ? st.kind[0].toUpperCase() + st.kind.slice(1) : 'Star system'}</td></tr>
        {st.id !== 0 && <tr><td>{spaceSettingsOf(s.world?.get('map_space', s.spaceId))?.galaxy?.kind === 'invented' ? 'From home' : 'From the Sun'}</td><td data-testid="star-distance">{Math.round(st.dist).toLocaleString('en-GB')} light-years</td></tr>}
        <tr><td>From the middle</td><td>{Math.round(Math.hypot(st.x, st.y, st.z)).toLocaleString('en-GB')} light-years</td></tr>
      </tbody></table> : solar ? <table className="facts"><tbody>
        <tr><td>Kind</td><td data-testid="star-kind">{st.id === 0 ? 'Our star' : moon ? `Moon of ${BODIES.find((x) => x.id === moon.planet)?.name ?? 'a planet'}` : body?.id === 9 ? 'Dwarf planet' : 'Planet'}</td></tr>
        {(body || moon) && <tr><td>From the Sun</td><td data-testid="star-distance">{st.dist.toFixed(2)} au ({Math.round(st.dist * 149.598).toLocaleString()} million km) on {fmt(s.time)}</td></tr>}
        {body && <tr><td>Goes round in</td><td>{orbitalYears(body) < 2 ? `${Math.round(orbitalYears(body) * 365.25)} days` : `${orbitalYears(body).toFixed(1)} years`}</td></tr>}
        {moon && <tr><td>Goes round in</td><td>{moon.days < 2 ? `${(moon.days * 24).toFixed(1)} hours` : `${moon.days.toFixed(1)} days`}{moon.retrograde ? ' (the other way round)' : ''}</td></tr>}
        {moon && <tr><td colSpan={2} className="muted">Drawn round its planet far wider than it is.{moon.placed ? ' Where it is on this date, roughly.' : ' Where it is along its orbit is not its true place.'}</td></tr>}
      </tbody></table> : <table className="facts"><tbody>
        <tr><td>Distance</td><td data-testid="star-distance">{st.id === 0 ? 'Here: the Sun' : `${st.dist.toFixed(2)} light-years`}</td></tr>
        <tr><td>Kind</td><td>{st.id === 0 ? 'Sun-like star' : starKind(st.spect)} ({st.spect || 'type unknown'})</td></tr>
        <tr><td>Brightness</td><td>absolute magnitude {Number.isFinite(st.absmag) ? st.absmag.toFixed(2) : '?'} <span className="muted">(the Sun: 4.85; higher is fainter)</span></td></tr>
        {st.id !== 0 && <tr><td>Direction</td><td>galactic longitude {g.l.toFixed(1)}°, latitude {g.b.toFixed(1)}°</td></tr>}
      </tbody></table>}
      {known.length > 0 && <>
        <h4>Known planets</h4>
        <div data-testid="star-planets">{known.map((p) => (
          <div key={p.name} className="row" data-testid="star-planet" title={p.year ? `Found in ${p.year}${p.method ? ` ${foundBy(p.method)}` : ''}` : ''}>
            <b>{p.name}</b> <span className="muted">· {p.days !== null ? (p.days < 2 ? `round its star in ${(p.days * 24).toFixed(1)} hours` : p.days < 1000 ? `round its star in ${p.days < 20 ? p.days.toFixed(1) : Math.round(p.days)} days` : `round its star in ${(p.days / 365.25).toFixed(1)} years`) : 'its year not known'}{p.au !== null ? `, ${p.au < 0.1 ? p.au.toFixed(3) : p.au.toFixed(2)} au out` : ''} · {planetSize(p)}{p.year ? ` · found ${p.year}` : ''}</span>
          </div>))}</div>
        <p className="muted">From the Open Exoplanet Catalogue (MIT licence).</p>
      </>}
      {system.length > 1 && <>
        <h4>Its system</h4>
        {system.map((x) => <div key={x.id} className={`row ${x.id === id ? 'sel' : ''}`} onClick={() => s.set({ selection: { kind: 'star', id: x.id } })}><span className="swatch" style={{ background: starColour(x.spect) }} />{x.name} <span className="muted">· {starKind(x.spect).toLowerCase()}</span></div>)}
      </>}
      <h4>Held by</h4>
      <div data-testid="star-holder">{holder ? <><span className="swatch" style={{ background: holder.color }} />{s.engine!.nameAt(holder.id, s.time) ?? holder.name} <span className="muted">on {fmt(s.time)}</span></> : <span className="muted">Nobody on {fmt(s.time)}</span>}</div>
      {steps.length > 0 && <div className="star-history">
        {steps.map((x) => { const e = x.entity ? s.world!.get('entity', x.entity) : null; const ev = s.world!.get('event', x.eventId); return (
          <div key={x.effectId} className="row" data-testid="star-step">
            <span className="date">{x.t.day === -Infinity ? 'From the beginning' : fmt(x.t)}</span> {e ? <><span className="swatch" style={{ background: e.color }} />{e.name}</> : 'nobody'}{ev && !isBaseEvent(ev.id) ? <span className="muted"> · {ev.name}</span> : null}
            <span className="row-tools">
              {x.t.day !== -Infinity && <button className="small" onClick={() => s.setTime(x.t)}>Go to</button>}
              <button className="small danger" title="Take this change back out" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, x.effectId))}>×</button>
            </span>
          </div>
        ); })}
      </div>}
      <p className="muted">To give it to a country or faction, use the Star systems tool{solar ? ' (on this map, it gives planets)' : ''}.</p>
      {lanes.length > 0 && <>
        <h4>Lanes on {fmt(s.time)}</h4>
        {lanes.map((l) => { const other = cat.byId.get(l.a === id ? l.b : l.a); const e = l.entity ? s.world!.get('entity', l.entity) : null; return (
          <div key={l.effectId} className="row" data-testid="star-lane">
            <span className="swatch" style={{ background: e?.color ?? '#9fb8d6' }} />to {other?.name ?? '?'}{e ? <span className="muted"> · {e.name}</span> : null}{l.progress < 1 ? <span className="muted"> · on its way ({Math.round(l.progress * 100)}%)</span> : null}
            <span className="row-tools"><button className="small" title="The lane is closed from the date viewed" onClick={() => s.execute((wd) => cmd.setLane(wd, { spaceId: s.spaceId, a: l.a, b: l.b, on: false, entity: '', mode: placementMode(), label: `the lane to ${other?.name ?? 'a star'}` }))} data-testid="star-lane-close">Closes on {fmt(s.time)}</button></span>
          </div>
        ); })}
      </>}
      <div className="buttons">
        <button onClick={() => s.setCamera({ ...s.camera, target: [st.x, st.y, st.z] })} data-testid="star-centre" title="The view turns around this star (⌂ goes back to the Sun)">Turn the view around it</button>
      </div>
      <p className="muted">{galaxy ? (st.minor || spaceSettingsOf(s.world?.get('map_space', s.spaceId))?.galaxy?.kind === 'invented' ? 'A star system of this map\'s own, made from its seed.' : 'Placed from where it is seen from the Sun (rounded distances from the literature); the arms after Reid et al. (2014).') : solar ? 'Positions from JPL\'s orbital elements of the planets (Standish), for the date viewed.' : 'Positions from the HYG database v4.1 (CC BY-SA 4.0).'}</p>
    </div>
  );
}
