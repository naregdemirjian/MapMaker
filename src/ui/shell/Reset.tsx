// The small button beside an adjustable value that puts it back to its default (D207).

const ICON = <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a5 5 0 1 0 1.6-3.7" /><path d="M3 2.5v3h3" /></svg>;

const label = (def: number | string) => `Back to the default (${def})`;

/** Puts a value back to `def` (greyed while it is there already). */
export function ResetButton({ def, at, onReset, testId }: { def: number | string; at: boolean; onReset: () => void; testId?: string }) {
  return (
    <button type="button" className="reset-default" disabled={at} title={label(def)} aria-label={label(def)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReset(); }} data-testid={testId}>{ICON}</button>
  );
}

/**
 * The same, for a slider written as a bare `<input type="range">`: placed straight after it, it sets the slider
 * to `def` as if it had been dragged there (its own handler takes the value as usual).
 */
export function RangeReset({ def, value, testId }: { def: number; value: number; testId?: string }) {
  return (
    <button type="button" className="reset-default" disabled={value === def} title={label(def)} aria-label={label(def)} data-testid={testId}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();
        let el: Element | null = e.currentTarget.previousElementSibling;
        while (el && !(el instanceof HTMLInputElement)) el = el.previousElementSibling;
        const input = el as HTMLInputElement | null;
        if (!input) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(def));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // (A slider that keeps its value until it is let go keeps it on the pointer coming up.)
        input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      }}>{ICON}</button>
  );
}
