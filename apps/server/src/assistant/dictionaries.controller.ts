/**
 * Proxies legacy Java dictionary endpoints whose URLs end in a literal
 * trailing slash. Next.js 16's `rewrites()` normalizes trailing slashes away
 * before forwarding, which breaks these endpoints (Java returns 404 without
 * the `/`). Routing through Nest with `fetch` bypasses that normalization —
 * we hit Java with the exact URL the frontend intends.
 *
 * Both endpoints are passthrough (raw Java envelope) so the existing
 * frontend `backendApi` unwrapping still works unchanged. The aspect-ratio
 * endpoint used to live here too; Java has since dropped the required
 * trailing slash, so the frontend now calls `/anon/enumMeta/...` directly.
 */
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { describeUnknown } from '../common/values';

type JavaService = 'content' | 'studio';

const LEGACY_ACCEPT_LANGUAGE = 'en-US';

@Controller('dictionaries')
export class DictionariesController {
  private readonly logger = new Logger(DictionariesController.name);

  @Get('product-types')
  getProductTypes(@Req() req: Request) {
    return this.forward(
      req,
      'studio',
      '/api/user/world/static/list/proudct/type/',
    );
  }

  @Get('painting-styles')
  getPaintingStyles(@Req() req: Request) {
    return this.forward(
      req,
      'studio',
      '/api/user/world/static/list/painting/style/',
    );
  }

  private async forward(req: Request, service: JavaService, path: string) {
    const envVar =
      service === 'content' ? 'JAVA_CONTENT_URL' : 'JAVA_STUDIO_URL';
    const base = process.env[envVar];
    if (!base) {
      throw new HttpException(
        `${envVar} is not configured`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const url = `${base.replace(/\/$/, '')}${path}`;
    const cookie = req.headers.cookie;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'accept-language': LEGACY_ACCEPT_LANGUAGE,
          ...(cookie ? { cookie } : {}),
        },
      });
    } catch (err) {
      this.logger.error(
        `[dictionaries] fetch failed ${path}: ${describeUnknown(err)}`,
      );
      throw new HttpException('upstream unreachable', HttpStatus.BAD_GATEWAY);
    }

    const text = await response.text();
    if (!response.ok) {
      this.logger.warn(
        `[dictionaries] HTTP ${response.status} ${path}: ${text.slice(0, 300)}`,
      );
      throw new HttpException(
        text || `upstream ${response.status}`,
        response.status,
      );
    }

    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      this.logger.error(
        `[dictionaries] invalid JSON from ${path}: ${text.slice(0, 300)}`,
      );
      throw new HttpException(
        'invalid json from upstream',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
