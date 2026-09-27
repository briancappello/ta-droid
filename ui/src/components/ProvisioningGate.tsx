// Full-screen passphrase prompt before anything else (credential-provisioning
// spec). No lockout; the passphrase is never kept after a submit.
import { useState, type ReactNode } from 'react';
import { useAccounts } from '../state/accounts';
import styles from './ProvisioningGate.module.css';

export const MESSAGES = {
  'bad-passphrase': 'Incorrect passphrase.',
  'save-failed': 'Could not save credentials to secure storage.',
} as const;

export function ProvisioningGate({ children }: { children: ReactNode }) {
  const { provStatus, provision } = useAccounts();
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (provStatus === 'checking') return null;
  if (provStatus === 'ready') return <>{children}</>;

  return (
    <form
      className={styles.gate}
      data-testid="provisioning"
      onSubmit={async e => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const outcome = await provision(pass);
        setPass('');
        setBusy(false);
        if (outcome !== 'ok') setError(MESSAGES[outcome]);
      }}
    >
      <h1 className={styles.title}>Enter provisioning passphrase</h1>
      <input
        className={styles.input}
        type="password"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="Passphrase"
        value={pass}
        onChange={e => setPass(e.target.value)}
        disabled={busy}
        data-testid="passphrase"
      />
      {error && (
        <p className={styles.error} role="alert" data-testid="provisioning-error">
          {error}
        </p>
      )}
      <button className={styles.button} type="submit" disabled={busy} data-testid="unlock">
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      {busy && <p className={styles.busy}>Deriving the key; this takes a few seconds.</p>}
    </form>
  );
}
