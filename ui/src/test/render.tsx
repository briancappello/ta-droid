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
