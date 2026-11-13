import type { PairingPayload } from './pairing';

export const pcmPairing: PairingPayload = {
  version: 1,
  address: '192.168.1.20',
  port: 8422,
  path: '/ws',
  token: '0123456789abcdef',
};
