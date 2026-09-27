import { useState } from 'react';
import type { WatchlistRef } from '../bindings/WatchlistRef';
import local from '../screens/WatchlistsScreen.module.css';
import { Modal } from './Modal';
import styles from './ui.module.css';

export function WatchlistPicker({
  lists,
  selectedId,
  onSelect,
}: {
  lists: WatchlistRef[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = lists.find(l => l.id === selectedId);
  return (
    <>
      <button className={styles.pickerButton} onClick={() => setOpen(true)} data-testid="watchlist-picker">
        {selected ? selected.name : 'Select'} ▾
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} testId="watchlist-menu">
          {lists.map(l => {
            const on = l.id === selectedId;
            return (
              <button
                key={l.id}
                className={styles.menuItem}
                aria-selected={on}
                data-testid={`watchlist-option-${l.id}`}
                onClick={() => {
                  onSelect(l.id);
                  setOpen(false);
                }}
              >
                <span className={`${local.radio} ${on ? local.radioOn : ''}`} />
                {l.name}
              </button>
            );
          })}
        </Modal>
      )}
    </>
  );
}
