// Bundled on its own and added to the page by e2e/render-compare.e2e.ts: the old renderer, to draw
// the same scenes as the app's renderer for comparison.
import { MapRenderer } from './map-renderer.ts';

(window as unknown as { __reference: unknown }).__reference = { MapRenderer };
