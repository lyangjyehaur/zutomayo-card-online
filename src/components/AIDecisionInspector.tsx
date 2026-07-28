import { Activity, ChevronDown, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, IconButton } from '../ui';
import {
  AI_DECISION_EVENT,
  appendAIInspectorDecision,
  isAIInspectorDecision,
  type AIInspectorDecision,
} from './aiDecisionTraceHistory';

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : String(value);
}

export function AIDecisionInspector() {
  const [history, setHistory] = useState<AIInspectorDecision[]>([]);
  const [selected, setSelected] = useState<AIInspectorDecision | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onDecision = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isAIInspectorDecision(detail)) return;
      setHistory((current) => appendAIInspectorDecision(current, detail));
      setSelected(detail);
    };
    window.addEventListener(AI_DECISION_EVENT, onDecision);
    return () => window.removeEventListener(AI_DECISION_EVENT, onDecision);
  }, []);

  if (!expanded) {
    return (
      <div className="fixed bottom-3 right-3 z-[var(--z-max)] flex items-center gap-1 rounded-sm border border-border-soft bg-surface-canvas/95 p-1 shadow-popover backdrop-blur">
        {history.length > 0 && <Badge tone="gold">{history.length}</Badge>}
        <IconButton
          label="Open AI decision inspector"
          title="Open AI decision inspector"
          icon={<Activity className="size-4" aria-hidden="true" />}
          aria-expanded="false"
          onClick={() => setExpanded(true)}
        />
      </div>
    );
  }

  return (
    <aside
      aria-label="AI decision inspector"
      className="fixed bottom-3 right-3 z-[var(--z-max)] flex max-h-[min(38rem,calc(100dvh-1.5rem))] w-[min(42rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-sm border border-border-strong bg-surface-canvas/95 font-mono text-caption text-content-muted shadow-popover backdrop-blur"
    >
      <header className="flex min-h-touch items-center gap-2 border-b border-border-soft px-3">
        <Activity className="size-4 text-accent-primary" aria-hidden="true" />
        <strong className="mr-auto text-control text-content-primary">AI Decision</strong>
        <Badge tone={selected?.fallback ? 'vermilion' : 'neutral'}>{history.length} traces</Badge>
        <IconButton
          label="Clear decision history"
          title="Clear decision history"
          size="sm"
          icon={<Trash2 className="size-4" aria-hidden="true" />}
          disabled={history.length === 0}
          onClick={() => {
            setHistory([]);
            setSelected(null);
          }}
        />
        <IconButton
          label="Collapse AI decision inspector"
          title="Collapse AI decision inspector"
          size="sm"
          icon={<ChevronDown className="size-4" aria-hidden="true" />}
          aria-expanded="true"
          onClick={() => setExpanded(false)}
        />
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.6fr)] max-sm:grid-cols-1">
        <ol className="max-h-60 overflow-y-auto border-r border-border-soft max-sm:border-b max-sm:border-r-0">
          {history.map((decision, index) => (
            <li key={`${decision.token}:${index}`}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 border-b border-border-soft px-3 py-2 text-left hover:bg-surface-panel ${
                  selected === decision ? 'bg-surface-panel text-content-primary' : ''
                }`}
                onClick={() => setSelected(decision)}
              >
                <span className="min-w-0 flex-1 truncate">{decision.kind}</span>
                <span className="tabular-nums">{decision.durationMs.toFixed(1)} ms</span>
              </button>
            </li>
          ))}
          {history.length === 0 && <li className="px-3 py-4 text-content-dim">Waiting for a decision.</li>}
        </ol>

        <div className="min-h-0 overflow-y-auto p-3">
          {selected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="gold">{selected.kind}</Badge>
                <Badge>score {formatScore(selected.score)}</Badge>
                <Badge>{selected.durationMs.toFixed(1)} ms</Badge>
              </div>
              <p className="text-control text-content-primary">{selected.reason}</p>
              {selected.fallback && (
                <p className="border-l-2 border-accent-action pl-2 text-accent-action">Fallback: {selected.fallback}</p>
              )}
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                {selected.factors.map((factor, index) => (
                  <div className="contents" key={`${factor.label}:${index}`}>
                    <dt className="min-w-0 break-words text-content-muted">
                      {factor.label}
                      {factor.detail ? `: ${factor.detail}` : ''}
                    </dt>
                    <dd className="text-right tabular-nums text-content-primary">{formatScore(factor.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="text-content-dim">No AI decision captured.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
