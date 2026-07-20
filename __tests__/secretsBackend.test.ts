// __tests__/secretsBackend.test.ts
import * as Keychain from 'react-native-keychain';
import { secretsDeps, readFingerprint } from '../src/secretsBackend';

jest.mock('react-native-keychain');

beforeEach(() => {
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
});

test('saveCred stores under service cred.<serviceKey>', async () => {
  await secretsDeps.saveCred('alpaca:PA1', 'KEY', 'SECRET');
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith('KEY', 'SECRET', {
    service: 'cred.alpaca:PA1',
  });
});

test('readFingerprint returns the stored password', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
    username: 'fp',
    password: 'FINGERPRINT',
  });
  expect(await readFingerprint()).toBe('FINGERPRINT');
});
