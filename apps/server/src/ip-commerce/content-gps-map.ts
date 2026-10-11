import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth';
import { RateLimitService } from '../common/throttle/rate-limit.service';

const PROXY_PATH = '/aurora/ip-commerce/content-gps-map/_AMapService';

/** Browser keys are public and must be domain-restricted at the provider.
 * The Gaode security code is deliberately never part of this response. */
export function contentGpsMapConfig(env = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value)
      throw new ServiceUnavailableException(
        `Map configuration missing: ${name}.`,
      );
    return value;
  };
  if (required('CONTENT_GPS_MAP_ENABLED') !== 'true')
    throw new ServiceUnavailableException('Content GPS map is not enabled.');
  const region = env.NEXT_PUBLIC_SITE_REGION ?? env.SITE_REGION;
  if (region === 'global' || region === 'com')
    return {
      provider: 'google' as const,
      key: required('CONTENT_GPS_GOOGLE_KEY'),
      mapId: required('CONTENT_GPS_GOOGLE_MAP_ID'),
    };
  if (region === 'cn') {
    required('CONTENT_GPS_GAODE_SECURITY_CODE');
    return {
      provider: 'gaode' as const,
      key: required('CONTENT_GPS_GAODE_KEY'),
      securityProxyPath: PROXY_PATH,
    };
  }
  throw new ServiceUnavailableException(
    'Map configuration requires an explicit site region.',
  );
}

export function gaodeProxyUrl(path: string, query: string, env = process.env) {
  const config = contentGpsMapConfig(env);
  if (config.provider !== 'gaode') throw new NotFoundException();
  // No arbitrary upstream hosts, encoded traversal, redirects or write methods.
  if (!/^v[34]\/[A-Za-z0-9_/-]+$/.test(path) || query.length > 16000)
    throw new BadRequestException('Invalid map request.');
  const host =
    path === 'v4/map/styles' || path === 'v4/map/lange'
      ? 'webapi.amap.com'
      : 'restapi.amap.com';
  const url = new URL(`https://${host}/${path}`);
  url.search = query;
  for (const name of ['callback', 'jsonp']) {
    if (
      url.searchParams
        .getAll(name)
        .some((value) => !/^[A-Za-z_$][\w.$]*$/.test(value))
    )
      throw new BadRequestException('Invalid map callback.');
  }
  url.searchParams.set('key', config.key);
  url.searchParams.set('jscode', env.CONTENT_GPS_GAODE_SECURITY_CODE!.trim());
  return url;
}

@Controller('ip-commerce/content-gps-map')
export class ContentGpsMapController {
  constructor(private readonly rateLimit: RateLimitService) {}

  @Public()
  @Get('config')
  @Header('Cache-Control', 'no-store')
  config() {
    return { code: 200, data: contentGpsMapConfig() };
  }

  @Public()
  @Get('_AMapService/*path')
  async gaode(
    @Param('path') rawPath: string | string[],
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const path = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;
    const url = gaodeProxyUrl(
      path,
      request.originalUrl.split('?').slice(1).join('?'),
    );
    await this.rateLimit.guard({
      bucket: 'content-gps-map',
      actorId: request.ip ?? 'unknown',
      max: 240,
      windowSec: 60,
    });
    // Forward no cookies/authorization, and never return/log the secret-bearing URL.
    try {
      const upstream = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok || !upstream.body)
        throw new Error('Map upstream failed');
      const contentType =
        upstream.headers.get('content-type') ?? 'application/octet-stream';
      if (
        !/^(application\/(json|javascript|x-javascript|octet-stream|x-protobuf)|text\/(javascript|plain)|image\/(png|jpeg|webp))(;|$)/i.test(
          contentType,
        )
      ) {
        await upstream.body.cancel();
        throw new Error('Unexpected map response type');
      }
      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 4 * 1024 * 1024)
            throw new Error('Map response too large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const body = Buffer.concat(chunks);
      // An upstream diagnostic must never echo our server-side security code.
      if (body.includes(process.env.CONTENT_GPS_GAODE_SECURITY_CODE!.trim()))
        throw new Error('Map upstream returned credentials');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', contentType);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.send(body);
    } catch {
      throw new BadGatewayException(
        'Map provider request failed. Please retry.',
      );
    }
  }
}
