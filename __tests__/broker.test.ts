// __tests__/broker.test.ts
import { driverFor, brokers } from '../src/broker';
import type { Account } from '../src/alpaca';

const paperAcct: Account = {
  id: 'PA123', name: 'Paper', broker: 'alpaca', is_paper: true, key: 'K', secret: 'S',
};

test('brokers registry has an alpaca entry with hosts', () => {
  expect(brokers.alpaca).toBeDefined();
  expect(brokers.alpaca.id).toBe('alpaca');
  expect(brokers.alpaca.hosts.paper).toBe('https://paper-api.alpaca.markets');
  expect(brokers.alpaca.hosts.live).toBe('https://api.alpaca.markets');
});

test('driverFor resolves the account broker driver', () => {
  const driver = driverFor(paperAcct);
  expect(driver).toBe(brokers.alpaca.driver);
  expect(typeof driver.listPositions).toBe('function');
  expect(typeof driver.listOrders).toBe('function');
  expect(typeof driver.createOrder).toBe('function');
  expect(typeof driver.closePosition).toBe('function');
});

test('driverFor throws for an unknown broker', () => {
  const bad = { ...paperAcct, broker: 'nope' } as unknown as Account;
  expect(() => driverFor(bad)).toThrow(/unknown broker/i);
});
