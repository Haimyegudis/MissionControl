// TextPrompt (ui-parity §10.7): title, message, single input, Cancel/OK.
// `useTextPrompt` gives a promise-returning API; resolves null on cancel.

import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';

export interface TextPromptProps {
  title: string;
  message: string;
  initialValue?: string;
  /** null = cancelled. */
  onClose: (value: string | null) => void;
}

export function TextPrompt({ title, message, initialValue = '', onClose }: TextPromptProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <Modal title={title} width={420} onClose={() => onClose(null)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {message}
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onClose(value);
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onClose(value)}>
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface PromptRequest {
  title: string;
  message: string;
  initialValue: string;
}

/**
 * Hook wrapper: render `element` once in the tree, then
 * `await prompt(title, message, initial)` → string | null.
 */
export function useTextPrompt(): {
  element: ReactNode;
  prompt: (title: string, message: string, initialValue?: string) => Promise<string | null>;
} {
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback((title: string, message: string, initialValue = '') => {
    return new Promise<string | null>((resolve) => {
      resolver.current?.(null); // cancel any prior pending prompt
      resolver.current = resolve;
      setRequest({ title, message, initialValue });
    });
  }, []);

  const element = request ? (
    <TextPrompt
      title={request.title}
      message={request.message}
      initialValue={request.initialValue}
      onClose={(value) => {
        setRequest(null);
        const resolve = resolver.current;
        resolver.current = null;
        resolve?.(value);
      }}
    />
  ) : null;

  return { element, prompt };
}
