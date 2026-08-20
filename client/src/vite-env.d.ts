/// <reference types="vite/client" />

/**
 * Build target, injected by Vite's `define`. Comparing against it produces a
 * compile-time constant, so a guarded `import()` is dropped from the bundle
 * rather than merely never executed.
 */
declare const __MC_TARGET__: 'desktop' | 'android';
