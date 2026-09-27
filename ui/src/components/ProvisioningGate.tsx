// Full-screen passphrase prompt before anything else (credential-provisioning
// spec). Completed in task 5.2.
import { useState, type ReactNode } from 'react';
import { useAccounts } from '../state/accounts';

export function ProvisioningGate({ children }: { children: ReactNode }) {
  const { provStatus, provision } = useAccounts();
  const [pass, setPass] = useState('');
  if (provStatus === 'checking') return null;
  if (provStatus === 'need-passphrase') {
    return (
      <form
        data-testid="provisioning"
        onSubmit={e => {
          e.preventDefault();
          void provision(pass).then(() => setPass(''));
        }}
      >
        <input type="password" value={pass} onChange={e => setPass(e.target.value)} data-testid="passphrase" />
        <button type="submit" data-testid="unlock">Unlock</button>
      </form>
    );
  }
  return <>{children}</>;
}
