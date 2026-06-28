import { Card } from '../Card';
import { t } from '../../i18n';
import type { DeckOptionGroup } from './shared';

export function DeckSelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: DeckOptionGroup[];
  onChange: (deckName: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="card-title">{label}</h3>
        <span className="text-sm opacity-70">{t('lobby.deckSelectHint')}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {options.map((group) => (
          <div className="flex flex-col gap-2" key={group.label}>
            <span className="text-sm font-semibold opacity-70">{group.label}</span>
            {group.options.map((option) => (
              <button
                key={option.id}
                className={`card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow ${
                  value === option.id ? 'ring ring-primary' : ''
                }`}
                type="button"
                disabled={option.disabled}
                onClick={() => onChange(option.id)}
              >
                <div className="card-body gap-3 p-4">
                  <div className="deck-preview-stack" aria-hidden="true">
                    {option.previewIds.map((id, index) => (
                      <Card
                        key={`${option.id}-${id}-${index}`}
                        card={{ instanceId: `${option.id}-${id}-${index}`, defId: id, faceUp: true }}
                        size="micro"
                      />
                    ))}
                  </div>
                  <div className="flex flex-col gap-1 text-left">
                    <strong>{option.name}</strong>
                    <span className="text-sm opacity-70">{option.description}</span>
                  </div>
                  <div className="card-actions">
                    {option.synced && <span className="badge badge-primary">{t('deck.synced')}</span>}
                    {value === option.id && <span className="badge badge-success">{t('common.selected')}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
