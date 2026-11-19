// How smoothly the screen is kept up with (D143): the app is given every frame the browser offers it; a frame
// it is too busy for comes late or not at all. Counted over the last second: how many frames, and the longest
// wait between two (a single hitch shows there even when the count hardly moves).

export class FrameMeter {
  private at: number[] = [];
  private gaps: number[] = [];
  private last = Number.NEGATIVE_INFINITY;

  /** A frame offered at `now` (milliseconds, as requestAnimationFrame gives them). */
  frame(now: number): void {
    const gap = now - this.last;
    this.last = now;
    // (A wait of a second or more: the window was hidden or the computer asleep. Counting starts again.)
    if (!(gap < 1000)) { this.at = []; this.gaps = []; return; }
    this.at.push(now);
    this.gaps.push(gap);
    while (this.at[0] <= now - 1000) { this.at.shift(); this.gaps.shift(); }
  }

  /** Frames a second over the last second (from the mean wait between two) and the longest wait in it, in milliseconds; null before two frames. */
  read(): { perSecond: number; longest: number } | null {
    const n = this.gaps.length;
    if (!n) return null;
    let sum = 0, longest = 0;
    for (const g of this.gaps) { sum += g; if (g > longest) longest = g; }
    return { perSecond: Math.round((1000 * n) / sum), longest };
  }
}
