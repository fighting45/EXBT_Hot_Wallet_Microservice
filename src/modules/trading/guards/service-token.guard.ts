import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Inbound HMAC auth for money-moving /api/trading routes (orders, account funding).
 *
 * Laravel must send:
 *   X-Timestamp:     <unix seconds>
 *   X-Service-Token: hex( HMAC-SHA256( "<timestamp>:<raw-body>", SERVICE_TOKEN_SECRET ) )
 *
 * Fails closed: if SERVICE_TOKEN_SECRET is unset the guard rejects, so trading endpoints
 * are never exposed unauthenticated. Replay window is 60 seconds.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly REPLAY_WINDOW_SEC = 60;

  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('SERVICE_TOKEN_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Trading auth not configured (SERVICE_TOKEN_SECRET missing)');
    }

    const req = context.switchToHttp().getRequest();
    const token = req.headers['x-service-token'];
    const timestamp = req.headers['x-timestamp'];

    if (!token || !timestamp) {
      throw new UnauthorizedException('Missing X-Service-Token or X-Timestamp');
    }

    const ts = parseInt(String(timestamp), 10);
    if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > this.REPLAY_WINDOW_SEC) {
      throw new UnauthorizedException('Stale or invalid X-Timestamp');
    }

    // Sign over the exact raw bytes; GET/empty-body requests sign the empty string.
    const rawBody: string = req.rawBody ? req.rawBody.toString('utf8') : '';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${ts}:${rawBody}`)
      .digest('hex');

    if (!this.timingSafeEqual(String(token), expected)) {
      throw new UnauthorizedException('Invalid X-Service-Token');
    }
    return true;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }
}
