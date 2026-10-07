import { CardCheckoutGuard } from './card-checkout.guard';
describe('card checkout origin', () => {
  it.each([undefined, 'https://evil.example', 'null'])(
    'blocks writes from %s',
    (origin) => {
      const guard = new CardCheckoutGuard({
        get: () => 'https://app.example.com',
      } as never);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { origin } }),
          getResponse: () => ({ setHeader: jest.fn() }),
        }),
      };
      expect(() => guard.canActivate(context as never)).toThrow();
    },
  );
  it('accepts only the configured frontend and disables caching', () => {
    const response = { setHeader: jest.fn() };
    const guard = new CardCheckoutGuard({
      get: () => 'https://app.example.com',
    } as never);
    expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { origin: 'https://app.example.com' },
          }),
          getResponse: () => response,
        }),
      } as never),
    ).toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
  });
});
