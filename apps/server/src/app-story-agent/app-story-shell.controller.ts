import {
  Controller,
  Get,
  Param,
  Res,
  Req,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appStoryAgentEnabled } from './app-story-agent.config';

export const APP_STORY_UI_PATH = '/aurora/app-story-agent/ui/index.html';
export function storyShellAsset(path: string): string | null {
  if (
    [
      'index.html',
      'app.js',
      'app.css',
      'experience-runtime/themes/core.film-dark.v1.json',
    ].includes(path)
  )
    return path;
  return /^chunks\/[A-Za-z0-9_-]+\.js$/.test(path) ? path : null;
}

/** Hosted beside the authenticated API; never expose the private planner port. */
@Controller('app-story-agent')
export class AppStoryShellController {
  @Get('config')
  config() {
    return {
      code: 200,
      data: { enabled: appStoryAgentEnabled(), path: APP_STORY_UI_PATH },
    };
  }

  @Get('ui/*path')
  async asset(
    @Param('path') raw: string | string[],
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    if (!appStoryAgentEnabled())
      throw new ServiceUnavailableException(
        'App Story is not enabled on this site.',
      );
    const path = storyShellAsset(Array.isArray(raw) ? raw.join('/') : raw);
    if (!path) throw new NotFoundException();
    // Both source and compiled controller live two levels below the Server root.
    const root = resolve(__dirname, '../../public/app-story-agent');
    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(root, path));
    } catch {
      throw new ServiceUnavailableException(
        'App Story interface is not installed. Rebuild the Server image.',
      );
    }
    if (path === 'index.html') {
      // The native document request has an explicit credential. Establish the
      // validated session before any asset/API requests, without exposing it to JS.
      if (!/^[A-Za-z0-9_-]+=[^;,\s]+$/.test(req.rawCookie))
        throw new ServiceUnavailableException(
          'Unable to initialize App Story session.',
        );
      res.setHeader(
        'Set-Cookie',
        `${req.rawCookie}; Path=/aurora/app-story-agent; HttpOnly; Secure; SameSite=Lax`,
      );
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' https: blob: data:; media-src 'self' https: blob:; connect-src 'self' https:; frame-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
    );
    res
      .type(
        path.endsWith('.html')
          ? 'html'
          : path.endsWith('.css')
            ? 'css'
            : path.endsWith('.json')
              ? 'json'
              : 'js',
      )
      .send(bytes);
  }
}
