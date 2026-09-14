import {
  IpEpisodeFeedbackController,
  IpEpisodeFeedbackService,
} from './ip-episode-feedback';
import type { AuthUser } from '../auth';
describe('episode feedback HTTP contract', () => {
  const result = { likes: 2, dislikes: 0, mine: 1 };
  const read = jest.fn().mockResolvedValue(result);
  const vote = jest.fn().mockResolvedValue(result);
  const controller = new IpEpisodeFeedbackController({
    read,
    vote,
  } as unknown as IpEpisodeFeedbackService);
  const params = { ipId: 'ip', episodeId: 'episode' };
  it('returns the success envelope used by the public API client', async () => {
    await expect(controller.read(params)).resolves.toEqual({
      code: 200,
      data: result,
    });
    await expect(
      controller.vote(params, { userId: 'viewer' } as AuthUser, { value: 1 }),
    ).resolves.toEqual({ code: 200, data: result });
  });
  it('preserves authorization failures instead of wrapping them as success', async () => {
    read.mockRejectedValueOnce(
      new Error('Published testing episode not found.'),
    );
    await expect(controller.read(params)).rejects.toThrow(
      'Published testing episode not found.',
    );
  });
});
