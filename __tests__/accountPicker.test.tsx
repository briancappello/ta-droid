// __tests__/accountPicker.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccountPicker } from '../src/components/AccountPicker';

const accounts = [
  { id: 'a', name: 'Paper', key: 'K', secret: 'S', env: 'paper' as const },
  { id: 'b', name: 'IRA', key: 'K2', secret: 'S2', env: 'live' as const },
];

test('renders the selected account name and env', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountPicker accounts={accounts} selectedId="b" onSelect={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('IRA');
  expect(json).toContain('LIVE');
});

test('shows a placeholder when nothing is selected', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountPicker accounts={accounts} selectedId={null} onSelect={() => {}} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Select account');
});
