import type { CreateWorldRequest } from '@repo/shared';
import { FalHappyOysterAdapter } from './fal-happy-oyster.adapter';
import type { FalHappyOysterClient } from './fal-happy-oyster.client';

describe('FalHappyOysterAdapter', () => {
  const run = jest.fn();
  const adapter = new FalHappyOysterAdapter({
    available: true,
    run,
  } as unknown as FalHappyOysterClient);

  beforeEach(() => run.mockReset());

  it('maps an adventure world to the documented fal control-plane contract', async () => {
    run.mockResolvedValue({
      encrypted_world_id: 'world-encrypted',
      status: 'generating',
      mode: 'adventure',
    });
    const input: CreateWorldRequest = {
      providerKey: 'fal:happy-oyster',
      mode: 'adventure',
      prompt: 'A rain-soaked late-Ming city under curfew.',
      eventStyle: 'dramatic',
      perspective: 'third_person',
      reference: {
        firstFrameUrl: 'https://media.example/opening.jpg',
        imageUrls: ['https://media.example/character.jpg'],
      },
    };

    await adapter.createWorld(input);

    expect(run).toHaveBeenCalledWith(
      'alibaba/happy-oyster/worlds/create',
      {
        mode: 'adventure',
        prompt: input.prompt,
        event_style: 'dramatic',
        sync: false,
        first_frame_image_url: 'https://media.example/opening.jpg',
        image_urls: ['https://media.example/character.jpg'],
        perspective: 'third_person',
      },
      expect.anything(),
    );
  });

  it('normalizes a documented world response that omits its optional mode', async () => {
    run.mockResolvedValue({
      encrypted_world_id: 'world-encrypted',
      status: 'generating',
    });

    await expect(
      adapter.createWorld({
        providerKey: 'fal:happy-oyster',
        mode: 'adventure',
        prompt: 'A rain-soaked late-Ming pleasure boat.',
        eventStyle: 'normal',
        perspective: 'third_person',
        reference: { imageUrls: [] },
      }),
    ).resolves.toMatchObject({ mode: 'adventure' });
  });

  it('returns the refreshed provider session id produced by travel binding', async () => {
    run.mockResolvedValue({ session_id: 'session-refreshed', bound: true });

    await expect(
      adapter.bindTravel({
        providerSessionId: 'session-original',
        providerTravelId: 'travel-encrypted',
      }),
    ).resolves.toEqual({ providerSessionId: 'session-refreshed', bound: true });
    expect(run).toHaveBeenCalledWith(
      'alibaba/happy-oyster/session/bind-travel',
      {
        session_id: 'session-original',
        encrypted_travel_id: 'travel-encrypted',
      },
      expect.anything(),
    );
  });

  it('omits absent browser stream metadata from travel status requests', async () => {
    run.mockResolvedValue({
      encrypted_travel_id: 'travel-encrypted',
      status: 'running',
    });

    await adapter.syncTravelStatus({ providerTravelId: 'travel-encrypted' });

    expect(run).toHaveBeenCalledWith(
      'alibaba/happy-oyster/travels/status',
      { encrypted_travel_id: 'travel-encrypted' },
      expect.anything(),
    );
  });
});
