import { EventEmitter } from 'node:events';
import { ViewerAssistanceController } from './viewer-assistance.controller';
const id = '11111111-1111-4111-8111-111111111111';
const ip = {
  id,
  title: 'Journey',
  summary: 'Quiet',
  privateNotes: 'secret',
  trailerAsset: { kind: 'video', url: 'https://fixture.invalid/video' },
  episodes: [],
};
const input = { preference: 'calm', locale: 'en-US' as const };
function fixture() {
  const ips = { listPublicIps: jest.fn().mockResolvedValue({ items: [ip] }) };
  const worker = {
    recommendViewing: jest
      .fn()
      .mockResolvedValue({ suggestions: [{ id, reason: 'Calm' }] }),
  };
  const service = new ViewerAssistanceController(
    ips as never,
    { get: () => worker } as never,
  );
  const res = new EventEmitter();
  return {
    ips,
    worker,
    res,
    run: () =>
      service.recommend(
        { userId: 'viewer' } as never,
        input,
        {} as never,
        res as never,
      ),
  };
}
it('sends only public candidate fields and excludes poster-only entries', async () => {
  const f = fixture();
  f.ips.listPublicIps.mockResolvedValue({
    items: [ip, { ...ip, id: 'poster', trailerAsset: null }],
  });
  expect(await f.run()).toEqual({
    suggestions: [{ id, title: 'Journey', reason: 'Calm' }],
  });
  expect(f.worker.recommendViewing).toHaveBeenCalledWith(
    {
      ...input,
      candidates: [{ id, title: 'Journey', summary: 'Quiet' }],
    },
    expect.any(AbortSignal),
  );
  expect(f.ips.listPublicIps).toHaveBeenNthCalledWith(2, expect.any(Object), {
    userId: 'viewer',
  });
  expect(f.res.listenerCount('close')).toBe(0);
});
it('removes withdrawn or blocked entries after the model wait', async () => {
  const f = fixture();
  f.ips.listPublicIps
    .mockResolvedValueOnce({ items: [ip] })
    .mockResolvedValueOnce({ items: [] });
  expect(await f.run()).toEqual({ suggestions: [] });
});
it('rejects invented model IDs rather than looking them up', async () => {
  const f = fixture();
  f.worker.recommendViewing.mockResolvedValue({
    suggestions: [{ id: 'other', reason: 'bad' }],
  });
  await expect(f.run()).rejects.toThrow('Invalid viewing recommendation');
  expect(f.ips.listPublicIps).toHaveBeenCalledTimes(1);
});
it('aborts on departure and discards late results', async () => {
  const f = fixture();
  f.worker.recommendViewing.mockImplementation(() => {
    f.res.emit('close');
    return Promise.resolve({ suggestions: [] });
  });
  await expect(f.run()).rejects.toThrow();
  expect(f.worker.recommendViewing).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ aborted: true }),
  );
  expect(f.ips.listPublicIps).toHaveBeenCalledTimes(1);
});
