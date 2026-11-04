import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AccessEvents extends EventEmitter {
  revoke(userId: string, sessionId?: string) {
    this.emit('revoked', userId, sessionId);
  }
}
