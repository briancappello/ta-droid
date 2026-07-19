// __tests__/appHeader.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppHeader } from '../src/components/AppHeader';
import * as backend from '../src/BackendContext';

jest.mock('../src/BackendContext');

function mockHealth(health: 'up' | 'down' | 'unknown') {
  (backend.useBackend as jest.Mock).mockReturnValue({
    health,
    setHealth: () => {},
    refresh: async () => {},
  });
}

test('renders the title and a BE chip', async () => {
  mockHealth('up');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AppHeader title="Positions" onMenuPress={() => {}} />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('Positions');
  expect(json).toContain('BE');
});

test('BE dot is green when up and red when down', async () => {
  mockHealth('up');
  let up!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    up = ReactTestRenderer.create(
      <AppHeader title="X" onMenuPress={() => {}} />,
    );
  });
  expect(JSON.stringify(up.toJSON())).toContain('#4caf50');

  mockHealth('down');
  let down!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    down = ReactTestRenderer.create(
      <AppHeader title="X" onMenuPress={() => {}} />,
    );
  });
  expect(JSON.stringify(down.toJSON())).toContain('#f44336');
});
