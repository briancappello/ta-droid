import { useState } from 'react';
import type { AccountView } from '../bindings/AccountView';
import { Modal } from './Modal';
import styles from './ui.module.css';

export function accountLabel(a: AccountView): string {
  return `${a.name}${a.is_paper ? ' · PAPER' : ''}`;
}

/** Account chooser (accounts spec: account presentation). */
export function AccountPicker({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: AccountView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find(a => a.id === selectedId) ?? null;
  return (
    <>
      <button className={styles.pickerButton} onClick={() => setOpen(true)} data-testid="account-picker">
        {selected ? accountLabel(selected) : 'Select account'} ▼
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} testId="account-menu">
          {accounts.map(a => (
            <button
              key={a.id}
              className={`${styles.menuItem} ${a.id === selectedId ? styles.menuItemActive : ''}`}
              aria-selected={a.id === selectedId}
              data-testid={`account-option-${a.id}`}
              onClick={() => {
                onSelect(a.id);
                setOpen(false);
              }}
            >
              {accountLabel(a)}
            </button>
          ))}
        </Modal>
      )}
    </>
  );
}
