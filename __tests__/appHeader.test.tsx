// __tests__/appHeader.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppHeader } from '../src/components/AppHeader';
import * as backend from '../src/BackendContext';

jest.mock('../src/BackendContext');

function mockHealth(
  marketstore: 'up' | 'down' | 'unknown',
  fatechan: 'up' | 'down' | 'unknown',
) {
  (backend.useBackend as jest.Mock).mockReturnValue({
    health: { marketstore, fatechan },
    setHealth: () => {},
    refresh: async () => {},
  });
}

test('renders the title and per-backend MS/FA chips', async () => {
  mockHealth('up', 'up');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AppHeader title="Positions" onMenuPress={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Positions');
  expect(json).toContain('MS');
  expect(json).toContain('FA');
});

test('dots reflect each backend independently', async () => {
  // MarketStore up (green), fa-techan down (red) at the same time.
  mockHealth('up', 'down');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AppHeader title="X" onMenuPress={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('#4caf50');
  expect(json).toContain('#f44336');
});
