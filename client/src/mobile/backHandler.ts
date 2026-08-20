// Android back-gesture stack.
//
// The mobile shell navigates with React state, not history, so the default
// handler saw an empty history and exited the app on the first back gesture.
// Screens and sheets push a handler while they are open; the topmost one that
// claims the press wins, and only when nothing claims it does the app ask to
// close.

type BackHandler = () => boolean;

const stack: BackHandler[] = [];

/** Register a handler while a screen or sheet is open. Returns an unregister. */
export function pushBackHandler(fn: BackHandler): () => void {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * Run the stack from the top. Returns true when something consumed the press,
 * false when the caller should treat it as "leave the app".
 */
export function handleBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i]()) return true;
  }
  return false;
}
