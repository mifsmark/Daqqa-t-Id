import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('public document routes', () => {
  it.each([
    ['/contact', 'Contact Daqqa t’Id', 'mailto:markanthonymifsud@yahoo.com', 'https://wa.me/35699894619'],
    ['/support', 'Support Daqqa t’Id', 'href="/contact"', 'Support a useful local service.'],
  ])('serves %s as a server-rendered public document', async (path, title, linkOne, linkTwo) => {
    const response = await SELF.fetch(new Request(`https://daqqa.test${path}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(linkOne);
    expect(html).toContain(linkTwo);
  });

  it('keeps unknown document routes as 404s', async () => {
    const response = await SELF.fetch(new Request('https://daqqa.test/not-a-page'));
    expect(response.status).toBe(404);
  });
});
