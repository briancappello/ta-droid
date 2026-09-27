import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** A centered menu over a dimmed backdrop; tapping outside closes it. */
export function Modal({ onClose, children, testId }: { onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <div className={styles.overlay} onClick={onClose} data-testid={testId ? `${testId}-overlay` : undefined}>
      <div className={styles.menu} onClick={e => e.stopPropagation()} role="dialog" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}
