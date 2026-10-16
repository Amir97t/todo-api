import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { getClientIp } from '../../src/common/get-client-ip.js';

type TestRequest = Pick<Request, 'ip' | 'socket'> & {
  headers?: Record<string, string>;
};

function makeReq(partial: TestRequest): TestRequest {
  return partial;
}

describe('getClientIp', () => {
  it('returns the Express-computed req.ip', () => {
    const req = makeReq({ ip: '203.0.113.7' });
    expect(getClientIp(req)).toBe('203.0.113.7');
  });

  it('never reads spoofable forwarding headers, even when present', () => {
    const req = makeReq({
      ip: '203.0.113.7',
      headers: {
        'x-forwarded-for': '198.51.100.99, 10.0.0.1',
        'x-real-ip': '192.0.2.55',
      },
    });
    // Bucket identity must come from req.ip (trust-proxy parse of the
    // edge-controlled chain), not from client-suppliable headers.
    expect(getClientIp(req)).toBe('203.0.113.7');
  });

  it('falls back to the socket remote address when req.ip is absent', () => {
    const req = makeReq({
      socket: { remoteAddress: '127.0.0.1' } as TestRequest['socket'],
    });
    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  it('falls back to a stable placeholder when no address is available', () => {
    const req = makeReq({});
    expect(getClientIp(req)).toBe('0.0.0.0');
  });
});
