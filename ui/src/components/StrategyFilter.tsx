// Multi-select strategy filter (trading spec: strategy tags and filter).
import { useState } from 'react';
import { Modal } from './Modal';
import styles from './ui.module.css';

export type StrategySelection = string[] | 'all';

export function strategyLabel(selection: StrategySelection): string {
  if (selection === 'all') return 'All';
  if (selection.length === 1) return selection[0];
  return `${selection.length} strategies`;
}

/** From All, one tap selects just that option; none or every option is All. */
export function toggle(selection: StrategySelection, option: string, options: string[], onChange: (s: StrategySelection) => void) {
  let next: string[];
  if (selection === 'all') next = [option];
  else if (selection.includes(option)) next = selection.filter(o => o !== option);
  else next = [...selection, option];
  onChange(next.length === 0 || next.length === options.length ? 'all' : next);
}

export function StrategyFilter({
  options,
  selection,
  onChange,
}: {
  options: string[];
  selection: StrategySelection;
  onChange: (s: StrategySelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const has = (o: string) => selection !== 'all' && selection.includes(o);
  return (
    <>
      <button className={styles.pickerButton} onClick={() => setOpen(true)} data-testid="strategy-filter">
        Strategy: {strategyLabel(selection)} ▾
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} testId="strategy-menu">
          <button className={styles.menuItem} aria-checked={selection === 'all'} role="menuitemcheckbox" onClick={() => onChange('all')} data-testid="strategy-all">
            {selection === 'all' ? '☑' : '☐'} All strategies
          </button>
          {options.map(o => (
            <button
              key={o}
              className={styles.menuItem}
              role="menuitemcheckbox"
              aria-checked={has(o)}
              data-testid={`strategy-option-${o}`}
              onClick={() => toggle(selection, o, options, onChange)}
            >
              {has(o) ? '☑' : '☐'} {o}
            </button>
          ))}
        </Modal>
      )}
    </>
  );
}
