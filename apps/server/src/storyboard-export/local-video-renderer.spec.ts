import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderLocalStoryboard } from './local-video-renderer';
(process.env.STORYBOARD_RENDER_INTEGRATION === '1' ? describe : describe.skip)(
  'server storyboard rendering with real FFmpeg',
  () => {
    let directory: string;
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'storyboard-source-test-'));
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=160x90:r=30:d=0.4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=0.4',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-c:a',
        'aac',
        '-shortest',
        join(directory, 'input-0.mp4'),
      ]);
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=90x160:r=24:d=0.6',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        join(directory, 'input-1.mp4'),
      ]);
    });
    afterAll(async () => rm(directory, { recursive: true, force: true }));
    const signal = () => new AbortController().signal;
    const render = (filenames = ['input-0.mp4', 'input-1.mp4']) =>
      renderLocalStoryboard(
        { directory, filenames, width: 160, height: 90 },
        signal(),
      );
    function pixel(path: string, second: number) {
      return execFileSync('ffmpeg', [
        '-v',
        'error',
        '-ss',
        String(second),
        '-i',
        path,
        '-frames:v',
        '1',
        '-vf',
        'crop=2:2:80:44',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        'pipe:1',
      ]);
    }
    it('preserves ordered clips, normalizes aspect/rate, and supplies silence for video without audio', async () => {
      const result = await render();
      try {
        expect(result.durationMs).toBe(1033); // 15 frames at 24fps rounds to 19 frames at 30fps.
        const red = pixel(result.path, 0.2),
          blue = pixel(result.path, 0.8);
        expect(red[0]).toBeGreaterThan(200);
        expect(red[2]).toBeLessThan(30);
        expect(blue[2]).toBeGreaterThan(200);
        expect(blue[0]).toBeLessThan(30);
        const pcm = execFileSync('ffmpeg', [
          '-v',
          'error',
          '-i',
          result.path,
          '-map',
          '0:a:0',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-f',
          'f32le',
          'pipe:1',
        ]);
        const energy = (start: number, end: number) => {
          let sum = 0;
          for (let i = start * 48000; i < end * 48000; i++)
            sum += Math.abs(pcm.readFloatLE(i * 4));
          return sum / ((end - start) * 48000);
        };
        expect(energy(0.1, 0.3)).toBeGreaterThan(0.01);
        expect(energy(0.6, 0.8)).toBeLessThan(0.0001);
      } finally {
        await result.dispose();
      }
      await expect(access(result.path)).rejects.toThrow();
    });
    it('honors a different shot order', async () => {
      const result = await render(['input-1.mp4', 'input-0.mp4']);
      try {
        expect(pixel(result.path, 0.2)[2]).toBeGreaterThan(200);
        expect(pixel(result.path, 0.8)[0]).toBeGreaterThan(200);
      } finally {
        await result.dispose();
      }
    });
    it('preserves delayed audio rather than moving it to the start of a clip', async () => {
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=green:s=160x90:r=30:d=0.6',
        '-itsoffset',
        '0.2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:sample_rate=48000:duration=0.2',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-c:a',
        'aac',
        join(directory, 'input-4.mp4'),
      ]);
      const result = await render(['input-4.mp4']);
      try {
        const pcm = execFileSync('ffmpeg', [
          '-v',
          'error',
          '-i',
          result.path,
          '-map',
          '0:a:0',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-f',
          'f32le',
          'pipe:1',
        ]);
        const energy = (start: number, end: number) => {
          let sum = 0;
          for (let i = start * 48000; i < end * 48000; i++)
            sum += Math.abs(pcm.readFloatLE(i * 4));
          return sum / ((end - start) * 48000);
        };
        expect(energy(0.04, 0.1)).toBeLessThan(0.0001);
        expect(energy(0.25, 0.3)).toBeGreaterThan(0.01);
        expect(energy(0.5, 0.55)).toBeLessThan(0.0001);
      } finally {
        await result.dispose();
      }
    });
    it('rejects remote paths, traversal, symlinks and invalid media', async () => {
      await expect(
        render(['https://private.invalid/video.mp4']),
      ).rejects.toThrow();
      await expect(render(['../input-0.mp4'])).rejects.toThrow();
      await symlink(
        join(directory, 'input-0.mp4'),
        join(directory, 'input-2.mp4'),
      );
      await expect(render(['input-2.mp4'])).rejects.toThrow('owned local file');
      await writeFile(join(directory, 'input-3.mp4'), 'not media');
      await expect(render(['input-3.mp4'])).rejects.toThrow(
        'media processing failed',
      );
    });
    it('does not start processing after cancellation', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        renderLocalStoryboard(
          { directory, filenames: ['input-0.mp4'], width: 160, height: 90 },
          controller.signal,
        ),
      ).rejects.toThrow();
    });
  },
);
