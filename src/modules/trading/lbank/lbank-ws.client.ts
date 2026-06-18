import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketDataService } from '../market-data.service';
import { ReconciliationService } from '../reconciliation.service';
import { LbankDepth } from './lbank.types';

// `ws` is present transitively; loaded via require to avoid a hard @types/ws dependency.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');

/**
 * Streams LBank v2 public market data (depth/kbar/trade) for the EXBT pair over WebSocket.
 *
 * - Depth snapshots are pushed into MarketDataService so the orderbook endpoint serves
 *   real-time data without polling REST.
 * - Trade ticks nudge reconciliation (debounced) so user fills settle promptly; the
 *   interval poll loop remains the authoritative safety net.
 *
 * Auto-reconnects with backoff and answers LBank's JSON ping/pong heartbeat.
 */
@Injectable()
export class LbankWsClient implements OnModuleInit, OnModuleDestroy {
  private ws: any;
  private symbol: string;
  private enabled: boolean;
  private wsUrl: string;
  private closing = false;
  private reconnectDelay = 1000;
  private pingTimer: NodeJS.Timeout;
  private lastReconcileNudge = 0;
  private readonly NUDGE_DEBOUNCE_MS = 3000;

  constructor(
    private config: ConfigService,
    private marketData: MarketDataService,
    private reconciliation: ReconciliationService,
  ) {
    this.symbol = this.config.get<string>('LBANK_SYMBOL', 'exbt_usdt');
    this.wsUrl = this.config.get<string>('LBANK_WS_URL', 'wss://www.lbkex.com/ws/V2/');
    this.enabled = this.config.get<string>('TRADING_ENABLED', 'true') === 'true';
  }

  onModuleInit() {
    if (!this.enabled) {
      console.log('[Trading][WS] TRADING_ENABLED=false — market stream not started');
      return;
    }
    this.connect();
  }

  onModuleDestroy() {
    this.closing = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
  }

  private connect() {
    if (this.closing) return;
    console.log(`[Trading][WS] connecting → ${this.wsUrl}`);
    this.ws = new WebSocket(this.wsUrl, { rejectUnauthorized: false });

    this.ws.on('open', () => {
      console.log(`[Trading][WS] connected — subscribing ${this.symbol}`);
      this.reconnectDelay = 1000;
      this.subscribe();
      this.startHeartbeat();
    });

    this.ws.on('message', (raw: Buffer) => this.onMessage(raw));
    this.ws.on('close', () => this.scheduleReconnect('closed'));
    this.ws.on('error', (err: Error) => {
      console.error('[Trading][WS] error:', err.message);
      try { this.ws.close(); } catch { /* ignore */ }
    });
  }

  private subscribe() {
    this.send({ action: 'subscribe', subscribe: 'depth', depth: '100', pair: this.symbol });
    this.send({ action: 'subscribe', subscribe: 'kbar', kbar: '1min', pair: this.symbol });
    this.send({ action: 'subscribe', subscribe: 'trade', pair: this.symbol });
  }

  private startHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.send({ action: 'ping', ping: Date.now().toString() });
    }, 20000);
  }

  private onMessage(raw: Buffer) {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Heartbeat from server → must echo back the same token.
    if (msg.action === 'ping') {
      this.send({ action: 'pong', pong: msg.ping });
      return;
    }
    if (msg.action === 'pong') return;

    switch (msg.type) {
      case 'depth':
        if (msg.depth) this.marketData.setLiveDepth(this.symbol, this.normalizeDepth(msg.depth));
        break;
      case 'trade':
        this.nudgeReconcile();
        break;
      // kbar updates are served fresh from REST on demand; no action needed here.
    }
  }

  private normalizeDepth(d: any): LbankDepth {
    const toPairs = (rows: any[]) => (rows || []).map((r: any[]) => [Number(r[0]), Number(r[1])] as [number, number]);
    return { asks: toPairs(d.asks), bids: toPairs(d.bids), timestamp: Date.now() };
  }

  private nudgeReconcile() {
    const now = Date.now();
    if (now - this.lastReconcileNudge < this.NUDGE_DEBOUNCE_MS) return;
    this.lastReconcileNudge = now;
    this.reconciliation.reconcileActiveOrders().catch(err =>
      console.error('[Trading][WS] nudge reconcile failed:', err.message),
    );
  }

  private send(obj: object) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
    } catch (err) {
      console.error('[Trading][WS] send failed:', (err as Error).message);
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.closing) return;
    console.warn(`[Trading][WS] ${reason} — reconnecting in ${this.reconnectDelay}ms`);
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }
}
