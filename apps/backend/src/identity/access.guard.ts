import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Database } from '../platform/database';
import { failure, PUBLIC_ROUTE, REQUIRED_ACTIONS, StudioRequest } from '../platform/http';
import type { Action } from './permissions';
import { Sessions } from './session.service';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly db: Database, private readonly sessions: Sessions) {}

  async canActivate(context: ExecutionContext) {
    const handler = context.getHandler();
    if (this.reflector.get<boolean>(PUBLIC_ROUTE, handler)) return true;
    const actions = this.reflector.get<Action[]>(REQUIRED_ACTIONS, handler);
    if (!actions?.length) throw failure(403, 'FORBIDDEN');
    const req = context.switchToHttp().getRequest<StudioRequest>();
    req.access = this.sessions.parseAccess(req.headers.authorization);
    await this.sessions.authorize(this.db, req.access, actions);
    return true;
  }
}
