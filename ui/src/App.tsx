import { useMemo } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ProvisioningGate } from './components/ProvisioningGate';
import { routes } from './routes';
import { AccountProvider } from './state/accounts';
import { BackendProvider } from './state/backend';

export function App({ initialPath = '/watchlists' }: { initialPath?: string }) {
  const router = useMemo(() => createMemoryRouter(routes, { initialEntries: [initialPath] }), [initialPath]);
  return (
    <main data-testid="app-root" style={{ display: 'contents' }}>
      <AccountProvider>
        <ProvisioningGate>
          <BackendProvider poll>
            <RouterProvider router={router} />
          </BackendProvider>
        </ProvisioningGate>
      </AccountProvider>
    </main>
  );
}
