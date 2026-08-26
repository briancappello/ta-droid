// __tests__/backendContext.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { BackendProvider, useBackend } from '../src/BackendContext';
import * as techan from '../src/techan';
import * as marketstore from '../src/marketstore';
jest.mock('../src/techan');
jest.mock('../src/marketstore');

function Probe({ onReady }: { onReady: (v: ReturnType<typeof useBackend>) => void }) {
  const v = useBackend();
  onReady(v);
  return <Text>{v.health.fatechan}</Text>;
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
  expect(latest!.health).toEqual({
    marketstore: 'unknown',
    fatechan: 'unknown',
  });
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
    latest!.setHealth({ marketstore: 'down', fatechan: 'down' });
  });
  expect(latest!.health).toEqual({ marketstore: 'down', fatechan: 'down' });
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

test('refresh sets per-backend health from independent probes', async () => {
  (marketstore.pingMarketstore as jest.Mock).mockResolvedValue(false);
  (techan.pingHealth as jest.Mock).mockResolvedValue(true);
  let latest: any = null;
  await act(async () => {
    ReactTestRenderer.create(
      <BackendProvider>
        <Probe onReady={v => (latest = v)} />
      </BackendProvider>,
    );
  });
  await act(async () => {
    await latest.refresh();
  });
  // MarketStore down but fa-techan up — reported independently.
  expect(latest.health).toEqual({ marketstore: 'down', fatechan: 'up' });

  (marketstore.pingMarketstore as jest.Mock).mockResolvedValue(true);
  (techan.pingHealth as jest.Mock).mockResolvedValue(false);
  await act(async () => {
    await latest.refresh();
  });
  expect(latest.health).toEqual({ marketstore: 'up', fatechan: 'down' });
});
