import 'reflect-metadata';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import { PlayableAudioProbeService } from '../src/media/playable-audio-probe.service';
import { PlayableVideoProbeService } from '../src/media/playable-video-probe.service';

/** Explicit diagnostic command: no upload, ledger writes, conversion or limit changes. */
async function main() {
  const [kind, input, ...extra] = process.argv.slice(2);
  if (
    !input ||
    extra.length ||
    !['audio', 'video', 'video-generic'].includes(kind)
  ) {
    throw new Error(
      'Usage: npm run media:inspect -w server -- <audio|video|video-generic> <local-file>',
    );
  }
  const filePath = resolve(input);
  if (!(await stat(filePath)).isFile())
    throw new Error('Input must be a regular local file.');
  const result =
    kind === 'audio'
      ? await new PlayableAudioProbeService().probeFile(filePath)
      : await new PlayableVideoProbeService().probeFile(filePath, {
          requireBrowserSafeMp4: kind === 'video',
        });
  process.stdout.write(`${JSON.stringify({ kind, result }, null, 2)}\n`);
}
void main().catch((error: unknown) => {
  const detail =
    error instanceof HttpException
      ? error.getResponse()
      : {
          message:
            error instanceof Error ? error.message : 'Media inspection failed.',
        };
  process.stderr.write(`${JSON.stringify({ error: detail }, null, 2)}\n`);
  process.exitCode = 1;
});
