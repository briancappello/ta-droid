// Ported from __tests__/backendContext.test.tsx.
import { act, render } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { mockBackend } from '../test/backend';
import { BackendProvider, POLL_MS, useBackend } from './backend';

type V = ReturnType<typeof useBackend>;
function Probe({ onReady }: { onReady: (v: V) => void }) {
  onReady(useBackend());
  return null;
}

afterEach(() => vi.useRealTimers());

test('health defaults to unknown', () => {
  let latest: V | null = null;
  render(<BackendProvider><Probe onReady={v => (latest = v)} /></BackendProvider>);
  expect(latest!.health).toEqual({ marketstore: 'unknown', fatechan: 'unknown' });
});

test('setHealth updates health', () => {
  let latest: V | null = null;
  render(<BackendProvider><Probe onReady={v => (latest = v)} /></BackendProvider>);
  act(() => latest!.setHealth({ marketstore: 'down', fatechan: 'down' }));
  expect(latest!.health).toEqual({ marketstore: 'down', fatechan: 'down' });
});

test('useBackend throws outside provider', () => {
  class Boundary extends Component<{ onErr: (e: Error) => void; children: ReactNode }> {
    componentDidCatch(e: Error) {
      this.props.onErr(e);
    }
    render() {
      return this.props.children;
    }
  }
  let captured: Error | null = null;
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const Bad = () => {
    useBackend();
    return null;
  };
  render(<Boundary onErr={e => (captured = e)}><Bad /></Boundary>);
  spy.mockRestore();
  expect(captured!.message).toMatch(/useBackend must be used within BackendProvider/);
});

test('refresh sets per-backend health independently', async () => {
  let next = { marketstore: 'down', fatechan: 'up' };
  mockBackend({ health: () => next });
  let latest: V | null = null;
  render(<BackendProvider><Probe onReady={v => (latest = v)} /></BackendProvider>);
  await act(() => latest!.refresh());
  expect(latest!.health).toEqual({ marketstore: 'down', fatechan: 'up' });
  next = { marketstore: 'up', fatechan: 'down' };
  await act(() => latest!.refresh());
  expect(latest!.health).toEqual({ marketstore: 'up', fatechan: 'down' });
});

test('polling probes at mount and then every 20 seconds', async () => {
  vi.useFakeTimers();
  const calls = mockBackend();
  render(<BackendProvider poll><Probe onReady={() => {}} /></BackendProvider>);
  const probes = () => calls.filter(c => c.cmd === 'health').length;
  await act(async () => {});
  expect(probes()).toBe(1);
  await act(async () => vi.advanceTimersByTime(POLL_MS - 1));
  expect(probes()).toBe(1);
  await act(async () => vi.advanceTimersByTime(1));
  expect(probes()).toBe(2);
});
