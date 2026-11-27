// Giving the Effects panel's effects to things (D238): to what is chosen (a double-click, Enter), or by dragging one
// onto a country on the map, into the Looks panel, or onto a row of the lists. Each gift is one undo step, and says
// what it did, or why it could not.
import { store } from './store.ts';
import * as cmd from '../domain/commands.ts';
import { parseJSON } from '../temporal-engine/engine.ts';
import { groupStyle } from '../domain/group-looks.ts';
import { countryLookOf, layerLookOf, type CountryLook, type LayerLook } from '../render-engine/country-look.ts';
import { layerBordersOf } from '../render-engine/border-look.ts';
import { givesTo, receiversText, withEffect, borderWith, labelWith, type EffectItem, type Receiver } from '../render-engine/effects-catalogue.ts';
import { GRAPHIC_TEMPLATES } from '../presentation/graphic-style.ts';
import { shotTransitions, withTransitionLook, type ShotSettings } from '../presentation/sequence.ts';
import { eventsBoxOf } from '../presentation/events-box.ts';
import { drawingNow } from './panels/DrawingLooks.tsx';
import { EFFECT_DEFAULTS } from '../render-engine/country-look.ts';
import { DRAWING_EFFECTS } from '../domain/drawings.ts';

/** Something an effect is given to. */
export type Target =
  | { kind: 'entity'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'layer'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'shot'; id: string }
  // (A drawing of a country's design, chosen in the Looks studio, D255.)
  | { kind: 'drawing'; owner: string; id: string };

/** What is chosen, as things an effect can be given to: every country chosen, a group, a layer, an event; in Presentation, the shot open. */
export function chosenTargets(): Target[] {
  const s = store, sel = s.selection;
  const dn = s.pageNow() === 'looks' ? drawingNow() : null;
  if (dn) return [{ kind: 'drawing', owner: dn.owner, id: dn.drawing.id }];
  if (sel?.kind === 'entity') {
    const ids = s.multi?.kind === 'entity' && s.multi.ids.includes(sel.id) ? s.multi.ids : [sel.id];
    return ids.map((id) => ({ kind: 'entity', id }));
  }
  if (sel?.kind === 'group' || sel?.kind === 'layer' || sel?.kind === 'event') return [{ kind: sel.kind, id: sel.id }];
  if (s.mode === 'present' && s.shotId) return [{ kind: 'shot', id: s.shotId }];
  return [];
}

/** The things in words ("Kingdom of Testa", "the 3 chosen", "the group “Allies”", …). */
export function targetsText(targets: Target[]): string {
  const w = store.world;
  if (!w || !targets.length) return 'nothing';
  if (targets.length > 1) return `the ${targets.length} chosen`;
  const t = targets[0];
  switch (t.kind) {
    case 'entity': return w.get('entity', t.id)?.name ?? 'it';
    case 'group': return `the group “${w.get('entity_group', t.id)?.name ?? ''}”`;
    case 'layer': return `the layer “${w.get('layer', t.id)?.name ?? ''}”`;
    case 'event': return `the event “${w.get('event', t.id)?.name ?? ''}”`;
    case 'shot': return `the shot “${w.get('sequence', t.id)?.name ?? ''}”`;
    case 'drawing': return `the drawing “${cmd.drawingsOfEntity(w.get('entity', t.owner)).find((x) => x.id === t.id)?.name ?? ''}”`;
  }
}

const isCountry = (id: string) => { const t = store.world?.get('entity', id)?.type_id; return t === 'polity' || t === 'faction'; };
const receiverOf = (t: Target): Receiver | null => (t.kind === 'entity' ? (isCountry(t.id) ? 'country' : null) : t.kind === 'drawing' ? null : t.kind);
const EMPTY: CountryLook = { elevation: 0, opacity: 1, effects: [] };
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Gives an effect to things (one undo step). A border effect given to a country or a group goes to the borders of the
 * layer drawn on, where borders belong. Returns what was done, or why not.
 */
export function give(item: EffectItem, targets: Target[]): { ok: boolean; message: string } {
  // (Looks read and given as the Looks panel does: in Presentation, this shot's own when changing this shot only, D239.)
  const s = store, w = s.lookWorld;
  if (!w) return { ok: false, message: 'Open a project first.' };
  if (!targets.length) return { ok: false, message: `Choose something to give “${item.name}” to (${receiversText(item)}), or drag it there.` };
  const first = targets[0];
  // (A drawing takes the effects that cast from what it draws, D255.)
  if (first.kind === 'drawing') {
    const d = cmd.drawingsOfEntity(w.get('entity', first.owner)).find((x) => x.id === first.id);
    if (!d) return { ok: false, message: 'That drawing is no longer there.' };
    if (item.folder !== 'countries' || !(DRAWING_EFFECTS as readonly string[]).includes(item.kind)) return { ok: false, message: 'A drawing takes a drop shadow or an outer glow.' };
    s.executeLooks((wd) => cmd.updateDrawing(wd, first.owner, first.id, { effects: [...d.effects, { ...EFFECT_DEFAULTS[item.kind as (typeof DRAWING_EFFECTS)[number]] }] }));
    return { ok: true, message: `${item.name} given to the drawing “${d.name}”.` };
  }
  const recv = receiverOf(first);
  if (!recv) return { ok: false, message: `Effects are for countries; a person's or a city's looks are in its Looks panel.` };
  // (Borders belong to a layer: given to a country or a group, the layer drawn on.)
  if (item.folder === 'borders' && (recv === 'country' || recv === 'group')) {
    const layer = w.get('layer', s.layerId);
    if (!layer || layer.kind !== 'partition') return { ok: false, message: 'Borders belong to a layer of territory: choose one to draw on.' };
    return give(item, [{ kind: 'layer', id: layer.id }]);
  }
  if (!givesTo(item, recv)) return { ok: false, message: `“${item.name}” is for ${receiversText(item)}.` };
  const where = targetsText(targets);
  const done = (message: string) => ({ ok: true, message });
  const countries = targets.filter((t): t is { kind: 'entity'; id: string } => t.kind === 'entity' && isCountry(t.id)).map((t) => t.id);
  switch (item.folder) {
    case 'countries': {
      if (recv === 'country') {
        s.executeLooks((wd) => cmd.setCountriesOwnLooks(wd, countries.map((id) => [id, withEffect(countryLookOf(cmd.entityStyle(wd.get('entity', id)).look), item.kind)] as [string, CountryLook]), `a ${lc(item.name)}`));
        return done(`${item.name} given to ${where}.`);
      }
      if (first.kind === 'group') {
        const g = w.get('entity_group', first.id)!;
        s.executeLooks((wd) => cmd.setGroupStyle(wd, first.id, { look: withEffect(groupStyle(g).look ?? null, item.kind) }));
        return done(`${item.name} given to ${where}: all of its members.`);
      }
      if (first.kind === 'layer') {
        const l = w.get('layer', first.id);
        if (!l || l.kind !== 'partition') return { ok: false, message: 'Effects of countries are for a layer of territory.' };
        const look = layerLookOf(parseJSON<{ look?: unknown }>(l.style, {}).look) ?? { ...EMPTY, blend: 'normal' as const };
        s.executeLooks((wd) => cmd.setLayerEffects(wd, first.id, withEffect(look, item.kind) as LayerLook));
        return done(`${item.name} given to ${where}: its countries without a look of their own.`);
      }
      break;
    }
    case 'borders': {
      const l = first.kind === 'layer' ? w.get('layer', first.id) : undefined;
      if (!l || l.kind !== 'partition') return { ok: false, message: 'Borders belong to a layer of territory.' };
      const b = layerBordersOf(parseJSON<{ borders?: unknown }>(l.style, {}).borders) ?? { between: null, coast: null, pairs: [] };
      s.executeLooks((wd) => cmd.setLayerBorders(wd, l.id, { ...b, between: item.id === 'borders:plain' ? null : borderWith(b.between, item.patch) }));
      return done(`${item.name}: the borders between countries of “${l.name}”.`);
    }
    case 'labels': {
      if (recv === 'country') { s.executeLooks((wd) => cmd.setLabelsWith(wd, countries, item.patch, item.name)); return done(`${item.name}: the label of ${where}.`); }
      if (first.kind === 'group') {
        const g = w.get('entity_group', first.id)!;
        s.executeLooks((wd) => cmd.setGroupStyle(wd, first.id, { label: labelWith(groupStyle(g).label, item.patch) }));
        return done(`${item.name}: the labels of ${where}.`);
      }
      break;
    }
    case 'graphics': {
      const tp = GRAPHIC_TEMPLATES.find((t) => t.id === item.template);
      const shot = first.kind === 'shot' ? parseJSON<ShotSettings | null>(w.get('sequence', first.id)?.settings ?? '', null) : null;
      if (!tp || !shot || first.kind !== 'shot') return { ok: false, message: `“${item.name}” is for a shot.` };
      const box = eventsBoxOf(shot.eventsBox);
      const eventsBox = { ...box, style: tp.style, titleColor: tp.colors.title, accentColor: tp.colors.accent, textColor: tp.colors.text, dateColor: tp.colors.text, background: tp.colors.background, backgroundOpacity: tp.colors.backgroundOpacity, font: tp.colors.font };
      s.execute((wd) => cmd.updateSequence(wd, first.id, { settings: { ...shot, eventsBox } }));
      return done(`${item.name}: the events box of ${where}.`);
    }
    case 'transitions': {
      if (first.kind === 'event') { s.execute((wd) => cmd.setEventLook(wd, first.id, item.look)); return done(`${item.name}: the changes of ${where} as they animate.`); }
      const shot = first.kind === 'shot' ? parseJSON<ShotSettings | null>(w.get('sequence', first.id)?.settings ?? '', null) : null;
      if (shot && first.kind === 'shot') {
        s.execute((wd) => cmd.updateSequence(wd, first.id, { settings: { ...shot, transitions: withTransitionLook(shotTransitions(shot), item.look) } }));
        return done(`${item.name}: the changes in ${where} as they animate.`);
      }
      break;
    }
    case 'saved': {
      if (recv === 'country') { s.executeLooks((wd) => cmd.setCountriesLook(wd, countries, item.look, `the look “${item.name}”`)); return done(`The look “${item.name}” given to ${where}.`); }
      if (first.kind === 'group') { s.executeLooks((wd) => cmd.setGroupStyle(wd, first.id, { look: item.look })); return done(`The look “${item.name}” given to ${where}.`); }
      if (first.kind === 'layer') {
        const l = w.get('layer', first.id);
        if (!l || l.kind !== 'partition') return { ok: false, message: 'A look of countries is for a layer of territory.' };
        const blend = layerLookOf(parseJSON<{ look?: unknown }>(l.style, {}).look)?.blend ?? 'normal';
        s.executeLooks((wd) => cmd.setLayerEffects(wd, first.id, { ...item.look, blend }));
        return done(`The look “${item.name}” given to ${where}.`);
      }
      break;
    }
  }
  return { ok: false, message: `“${item.name}” is for ${receiversText(item)}.` };
}

/** Gives an effect to what is chosen, telling what was done (a double-click or Enter in the Effects panel). */
export function giveToChosen(item: EffectItem): boolean {
  const r = give(item, chosenTargets());
  store.toast(r.message, r.ok ? 'info' : 'error');
  return r.ok;
}
