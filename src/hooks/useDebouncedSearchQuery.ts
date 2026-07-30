import { useEffect, useRef, useState, type CompositionEvent, type ChangeEvent } from 'react';

export interface DebouncedSearchInputBindings {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void;
}

export function useDebouncedSearchQuery({
  value,
  onCommit,
  delay = 250,
}: {
  value: string;
  onCommit: (value: string) => void;
  delay?: number;
}): {
  draft: string;
  setDraft: (value: string) => void;
  inputBindings: DebouncedSearchInputBindings;
  isComposing: boolean;
} {
  const [draft, setDraft] = useState(value);
  const [isComposing, setIsComposing] = useState(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (isComposing || draft === value) return;
    const timeoutId = window.setTimeout(() => onCommitRef.current(draft), delay);
    return () => window.clearTimeout(timeoutId);
  }, [delay, draft, isComposing, value]);

  return {
    draft,
    setDraft,
    isComposing,
    inputBindings: {
      value: draft,
      onChange: (event) => setDraft(event.target.value),
      onCompositionStart: () => setIsComposing(true),
      onCompositionEnd: (event) => {
        setDraft(event.currentTarget.value);
        setIsComposing(false);
      },
    },
  };
}
