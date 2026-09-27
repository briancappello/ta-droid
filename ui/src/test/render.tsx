// Render a screen inside the real providers and a memory router.
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AccountProvider } from '../state/accounts';
import { BackendProvider } from '../state/backend';

export async function renderAt(path: string, routes: { path: string; element: ReactElement }[]) {
  const router = createMemoryRouter(
    [...routes, { path: '*', element: <p data-testid="elsewhere" /> }],
    { initialEntries: [path] },
  );
  const r = render(
    <AccountProvider>
      <BackendProvider>
        <RouterProvider router={router} />
      </BackendProvider>
    </AccountProvider>,
  );
  await act(async () => {});
  return { ...r, router };
}

/** Like renderAt, inside the app Shell, with a history of entries. */
export async function renderInShell(entries: (string | { pathname: string; state?: unknown })[], routes: { path: string; element: ReactElement }[]) {
  const { Shell } = await import('../components/Shell');
  const router = createMemoryRouter(
    [{ element: <Shell />, children: [...routes, { path: '*', element: <p data-testid="elsewhere" /> }] }],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const r = render(
    <AccountProvider>
      <BackendProvider>
        <RouterProvider router={router} />
      </BackendProvider>
    </AccountProvider>,
  );
  await act(async () => {});
  return { ...r, router };
}
