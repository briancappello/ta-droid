// __tests__/accountPicker.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccountPicker } from '../src/components/AccountPicker';

const accounts = [
  { id: 'a', name: 'Paper', key: 'K', secret: 'S', broker: 'alpaca' as const, is_paper: true },
  { id: 'b', name: 'IRA', key: 'K2', secret: 'S2', broker: 'alpaca' as const, is_paper: false },
];

test('renders the selected account name and paper suffix', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountPicker accounts={accounts} selectedId="a" onSelect={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Paper');
  expect(json).toContain('· PAPER');
});

test('live account shows no suffix', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AccountPicker accounts={accounts} selectedId="b" onSelect={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('IRA');
  expect(json).not.toContain('· PAPER');
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
