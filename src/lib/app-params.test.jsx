// @vitest-environment node
import { describe, it, expect } from 'vitest';

describe('appParams (Node/SSR environment — no window global)', () => {
  it('does not throw when imported outside a browser context', async () => {
    // Regression test: fromUrl used to read window.location.href eagerly as a
    // default-value argument, crashing with "window is not defined" the moment
    // this module was imported in Node (e.g. by importing any page in a test).
    await expect(import('./app-params.js')).resolves.toBeDefined();
  });

  it('resolves fromUrl to undefined instead of crashing when there is no window', async () => {
    const { appParams } = await import('./app-params.js');
    expect(appParams.fromUrl).toBeUndefined();
  });
});
