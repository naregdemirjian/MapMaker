// Minimal type declarations for React 19, used because @types/react is not installed in the offline
// build environment. They keep the interface code type-checked loosely; replace with @types/react
// (npm install) when package installs are available.
declare module 'react' {
  export type ReactNode = any;
  export type SetState<T> = (v: T | ((prev: T) => T)) => void;
  export function useState<T>(init: T | (() => T)): [T, SetState<T>];
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(init: T): { current: T };
  export function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T;
  export const Fragment: any;
  export const StrictMode: any;
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements { [name: string]: any }
    interface ElementChildrenAttribute { children: {} }
  }
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: any): void; unmount(): void };
}
declare namespace JSX {
  type Element = any;
  interface IntrinsicElements { [name: string]: any }
}
