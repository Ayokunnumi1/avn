import { describe, expect, it } from 'vitest';
import { renderTemplate, DEFAULT_TEMPLATES, ConsoleSmsProvider, WebPushProvider } from '../src';

describe('templates', () => {
  it('renders variables and blanks unknown ones', () => {
    expect(renderTemplate('Hi {{name}}, code {{ code }} {{missing}}', { name: 'Ada', code: 123456 })).toBe('Hi Ada, code 123456 ');
  });
  it('keeps lock-screen copy free of addresses and outcomes', () => {
    const completed = DEFAULT_TEMPLATES['request.completed']!;
    expect(completed.body).not.toMatch(/VERIFIED|address:|street/i);
  });
});

describe('providers', () => {
  it('console SMS logs instead of sending', async () => {
    const logs: string[] = [];
    const p = new ConsoleSmsProvider((_o, m) => logs.push(m));
    await p.send('+2348000000000', 'hello');
    expect(logs[0]).toContain('SIMULATOR');
  });
  it('web push is disabled without VAPID keys', async () => {
    const p = new WebPushProvider();
    expect(p.enabled).toBe(false);
    await expect(p.send({ endpoint: 'x', p256dh: 'y', auth: 'z' }, { title: 't', body: 'b' })).rejects.toThrow('not configured');
  });
});
