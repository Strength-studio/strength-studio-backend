import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, SetMetadata, createParamDecorator } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import type { AccessContext } from '../identity/session.service';
import type { Action } from '../identity/permissions';

export const PUBLIC_ROUTE = 'public-route';
export const REQUIRED_ACTIONS = 'required-actions';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequireAction = (...actions: Action[]) => SetMetadata(REQUIRED_ACTIONS, actions);

export type StudioRequest = Request & { access?: AccessContext; requestId: string };
export const CurrentAccess = createParamDecorator((_, ctx) => ctx.switchToHttp().getRequest<StudioRequest>().access!);

export function failure(status: number, code: string): HttpException {
  return new HttpException({ code }, status);
}

export function requestContext(req: StudioRequest, res: Response, next: NextFunction) {
  req.requestId = randomUUID();
  const started = performance.now();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.once('finish', () => {
    process.stdout.write(JSON.stringify({ event: 'http', requestId: req.requestId,
      method: req.method, status: res.statusCode, durationMs: Math.round(performance.now() - started) }) + '\n');
  });
  next();
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<StudioRequest>();
    const res = http.getResponse<Response>();
    const parserStatus = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    const status = error instanceof HttpException ? error.getStatus()
      : parserStatus === 400 || parserStatus === 413 ? parserStatus : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    const code = typeof body === 'object' && body && 'code' in body ? body.code
      : status === 400 ? 'INVALID_INPUT'
        : status === 429 ? 'RATE_LIMITED'
          : status === 500 ? 'INTERNAL_ERROR' : HttpStatus[status] ?? 'REQUEST_FAILED';
    res.status(status).json({ code, requestId: req.requestId });
  }
}
