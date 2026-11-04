import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { Server, Socket } from 'socket.io';
import { CONFIG, Config } from '../platform/config';
import { AccessEvents } from './access-events';
import { Sessions, SocketAccess } from './session.service';

type StudioSocket = Socket & { data: { access: SocketAccess } };

@Injectable()
export class Realtime implements OnModuleDestroy {
  private io?: Server;
  private interval?: NodeJS.Timeout;
  private checksInProgress = false;
  private handshakes = 0;
  private readonly sockets = new Set<StudioSocket>();
  private readonly revoke = (userId: string, sessionId?: string) => {
    for (const socket of this.sockets) {
      const access = socket.data.access;
      if (access.userId === userId && (!sessionId || sessionId === access.sessionId)) socket.disconnect(true);
    }
  };

  constructor(@Inject(CONFIG) private readonly config: Config, private readonly sessions: Sessions, private readonly events: AccessEvents) {}

  attach(server: HttpServer) {
    const originAllowed = (origin?: string) => origin === undefined || origin === this.config.dashboardOrigin;
    this.io = new Server(server, {
      cors: { origin: this.config.dashboardOrigin ?? false },
      allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin)),
      maxHttpBufferSize: 4096, connectTimeout: 5000, serveClient: false,
    });
    this.io.engine.use((req: IncomingMessage, _res: ServerResponse, next: (error?: Error) => void) => next(originAllowed(req.headers.origin) ? undefined : new Error('FORBIDDEN')));
    this.io.use(async (socket, next) => {
      if (this.handshakes >= 8 || this.sockets.size + this.handshakes >= 128) return next(new Error('AUTH_BUSY'));
      this.handshakes++;
      try {
        socket.data.access = await this.sessions.consumeSocketTicket(socket.handshake.auth.ticket);
        next();
      } catch {
        next(new Error('UNAUTHENTICATED'));
      } finally {
        this.handshakes--;
      }
    });
    this.io.on('connection', socket => {
      const current = socket as StudioSocket;
      this.sockets.add(current);
      const expiresIn = Math.max(0, current.data.access.expiresAt.valueOf() - Date.now());
      const expiry = setTimeout(() => socket.disconnect(true), expiresIn);
      expiry.unref();
      socket.once('disconnect', () => { clearTimeout(expiry); this.sockets.delete(current); });
    });
    this.events.on('revoked', this.revoke);
    this.interval = setInterval(() => void this.recheck(), this.config.socketRecheckMs);
    this.interval.unref();
  }

  private async recheck() {
    if (this.checksInProgress || !this.sockets.size) return;
    this.checksInProgress = true;
    const connected = [...this.sockets];
    const deadline = setTimeout(() => connected.forEach(s => s.disconnect(true)), 5000);
    deadline.unref();
    try {
      const current = await this.sessions.currentSockets([...new Set(connected.map(s => s.data.access.sessionId))]);
      for (const socket of connected) {
        const access = socket.data.access;
        if (current.get(access.sessionId) !== access.fingerprint) socket.disconnect(true);
      }
    } catch {
      connected.forEach(socket => socket.disconnect(true));
    } finally {
      clearTimeout(deadline);
      this.checksInProgress = false;
    }
  }

  onModuleDestroy() {
    clearInterval(this.interval);
    this.events.off('revoked', this.revoke);
    this.io?.disconnectSockets(true);
    this.io?.engine.close();
  }
}
