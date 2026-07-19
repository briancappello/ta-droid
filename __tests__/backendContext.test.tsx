// __tests__/backendContext.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { BackendProvider, useBackend } from '../src/BackendContext';

function Probe({ onReady }: { onReady: (v: ReturnType<typeof useBackend>) => void }) {
  const v = useBackend();
  onReady(v);
  return <Text>{v.health}</Text>;
}

class Boundary extends React.Component<{
  onErr: (e: Error) => void;
  children: React.ReactNode;
}> {
  componentDidCatch(e: Error) {
    this.props.onErr(e);
  }
  render() {
    return this.props.children;
  }
}

test('health defaults to unknown', async () => {
  let latest: ReturnType<typeof useBackend> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <BackendProvider>
        <Probe onReady={v => (latest = v)} />
      </BackendProvider>,
    );
  });
  expect(latest!.health).toBe('unknown');
});

test('setHealth updates health', async () => {
  let latest: ReturnType<typeof useBackend> | null = null;
  await act(async () => {
    ReactTestRenderer.create(
      <BackendProvider>
        <Probe onReady={v => (latest = v)} />
      </BackendProvider>,
    );
  });
  await act(async () => {
    latest!.setHealth('down');
  });
  expect(latest!.health).toBe('down');
});

test('useBackend throws outside provider', async () => {
  let captured: Error | null = null;
  // React 19's renderer routes render throws to componentDidCatch and logs
  // via console.error rather than rethrowing out of create(); an error
  // boundary is the runtime-correct way to observe the guard throw.
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const Bad = () => {
    useBackend();
    return null;
  };
  await act(async () => {
    ReactTestRenderer.create(
      <Boundary onErr={e => (captured = e)}>
        <Bad />
      </Boundary>,
    );
  });
  spy.mockRestore();
  expect(captured).not.toBeNull();
  expect(captured!.message).toMatch(/useBackend must be used within BackendProvider/);
});
