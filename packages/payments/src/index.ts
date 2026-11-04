import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Provider-independent payment + payout architecture (spec Part 10).
 * Business code depends only on these interfaces. Paystack is the first real adapter;
 * the simulator is a clearly labelled development adapter that uses the SAME
 * signed-webhook code path and is refused in production by @avn/config.
 */
export type ProviderPaymentStatus = 'success' | 'failed' | 'abandoned' | 'pending';

export interface InitializeInput {
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}
export interface InitializeResult {
  authorizationUrl: string;
  providerReference: string;
}
export interface VerifyResult {
  status: ProviderPaymentStatus;
  amountMinor: number;
  currency: string;
  paidAt?: Date;
  channel?: string;
  gatewayResponse?: string;
  raw: unknown;
}
export interface WebhookEvent {
  eventKey: string;
  type: string;
  reference?: string;
  transferReference?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  verify(reference: string): Promise<VerifyResult>;
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: unknown): WebhookEvent;
  refund(reference: string, amountMinor?: number): Promise<{ status: 'pending' | 'processed' | 'failed'; raw: unknown }>;
}

export interface Bank {
  name: string;
  code: string;
}
export interface PayoutProvider {
  readonly name: string;
  listBanks(): Promise<Bank[]>;
  createRecipient(input: { name: string; accountNumber: string; bankCode: string }): Promise<{ recipientCode: string }>;
  transfer(input: {
    amountMinor: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<{ status: 'pending' | 'success' | 'failed'; providerReference: string; raw: unknown }>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

const headerValue = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);
const hmac512 = (secret: string, body: Buffer) => createHmac('sha512', secret).update(body).digest('hex');
function safeHexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length > 0 && ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ─── Paystack ────────────────────────────────────────────────────────────────
interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export class PaystackClient {
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly timeoutMs = 15000,
  ) {}

  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new PaymentProviderError('Paystack is unreachable', true, err);
    }
    const json = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;
    if (!res.ok || !json?.status) {
      throw new PaymentProviderError(json?.message ?? `Paystack HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    }
    return json.data;
  }
}

export class PaystackPaymentProvider implements PaymentProvider {
  readonly name = 'paystack';
  private readonly client: PaystackClient;
  constructor(
    private readonly secretKey: string,
    baseUrl?: string,
  ) {
    this.client = new PaystackClient(secretKey, baseUrl);
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const data = await this.client.call<{ authorization_url: string; reference: string }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountMinor,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });
    return { authorizationUrl: data.authorization_url, providerReference: data.reference };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const data = await this.client.call<{
      status: string;
      amount: number;
      currency: string;
      paid_at?: string;
      channel?: string;
      gateway_response?: string;
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const status: ProviderPaymentStatus =
      data.status === 'success' ? 'success' : data.status === 'failed' ? 'failed' : data.status === 'abandoned' ? 'abandoned' : 'pending';
    return {
      status,
      amountMinor: data.amount,
      currency: data.currency,
      paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
      channel: data.channel,
      gatewayResponse: data.gateway_response,
      raw: data,
    };
  }

  /** Paystack signs the raw body with HMAC-SHA512 using the secret key (x-paystack-signature). */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = headerValue(headers['x-paystack-signature']);
    return !!sig && safeHexEqual(hmac512(this.secretKey, rawBody), sig);
  }

  parseWebhook(body: unknown): WebhookEvent {
    const b = body as { event?: string; data?: { id?: number | string; reference?: string; transfer_code?: string } };
    const type = b.event ?? 'unknown';
    const id = b.data?.id ?? b.data?.reference ?? b.data?.transfer_code ?? 'none';
    const isTransfer = type.startsWith('transfer.');
    return {
      eventKey: `${type}:${id}`,
      type,
      reference: isTransfer ? undefined : b.data?.reference,
      transferReference: isTransfer ? b.data?.reference : undefined,
      raw: body,
    };
  }

  async refund(reference: string, amountMinor?: number) {
    const data = await this.client.call<{ status: string }>('POST', '/refund', { transaction: reference, amount: amountMinor });
    return { status: data.status === 'processed' ? ('processed' as const) : ('pending' as const), raw: data };
  }
}

export class PaystackPayoutProvider implements PayoutProvider {
  readonly name = 'paystack';
  private readonly client: PaystackClient;
  constructor(secretKey: string, baseUrl?: string) {
    this.client = new PaystackClient(secretKey, baseUrl);
  }
  async listBanks(): Promise<Bank[]> {
    const data = await this.client.call<Array<{ name: string; code: string }>>('GET', '/bank?country=nigeria&perPage=100');
    return data.map((b) => ({ name: b.name, code: b.code }));
  }
  async createRecipient(input: { name: string; accountNumber: string; bankCode: string }) {
    const data = await this.client.call<{ recipient_code: string }>('POST', '/transferrecipient', {
      type: 'nuban',
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: 'NGN',
    });
    return { recipientCode: data.recipient_code };
  }
  async transfer(input: { amountMinor: number; recipientCode: string; reference: string; reason: string }) {
    const data = await this.client.call<{ status: string; transfer_code: string }>('POST', '/transfer', {
      source: 'balance',
      amount: input.amountMinor,
      recipient: input.recipientCode,
      reference: input.reference,
      reason: input.reason,
    });
    const status = data.status === 'success' ? 'success' : data.status === 'failed' ? 'failed' : 'pending';
    return { status: status as 'pending' | 'success' | 'failed', providerReference: data.transfer_code, raw: data };
  }
}

// ─── Development simulator ───────────────────────────────────────────────────
/**
 * DEVELOPMENT SIMULATOR — never enabled in production (enforced by config validation).
 * Mirrors Paystack semantics: a hosted checkout URL, server-side verification and an
 * HMAC-SHA512 signed webhook (header x-avn-simulator-signature).
 */
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly name = 'simulator';
  private readonly outcomes = new Map<string, { status: ProviderPaymentStatus; amountMinor: number; currency: string; paidAt?: Date }>();

  constructor(
    private readonly signingSecret: string,
    private readonly checkoutBaseUrl: string,
  ) {}

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    this.outcomes.set(input.reference, { status: 'pending', amountMinor: input.amountMinor, currency: input.currency });
    return { authorizationUrl: `${this.checkoutBaseUrl}/${encodeURIComponent(input.reference)}`, providerReference: `sim_${input.reference}` };
  }

  /** Called by the simulator checkout page; returns the signed webhook to deliver. */
  complete(reference: string, success: boolean): { body: string; signature: string } {
    const o = this.outcomes.get(reference) ?? { status: 'pending' as const, amountMinor: 0, currency: 'NGN' };
    const next = { ...o, status: success ? ('success' as const) : ('failed' as const), paidAt: success ? new Date() : undefined };
    this.outcomes.set(reference, next);
    const body = JSON.stringify({
      event: success ? 'charge.success' : 'charge.failed',
      data: { id: `sim_${reference}_${next.status}`, reference, amount: next.amountMinor, currency: next.currency, status: next.status },
    });
    return { body, signature: hmac512(this.signingSecret, Buffer.from(body)) };
  }

  /** Lets the simulator rehydrate after an API restart (amount comes from our own Payment row). */
  remember(reference: string, amountMinor: number, currency: string) {
    if (!this.outcomes.has(reference)) this.outcomes.set(reference, { status: 'pending', amountMinor, currency });
  }

  async verify(reference: string): Promise<VerifyResult> {
    const o = this.outcomes.get(reference);
    if (!o) return { status: 'pending', amountMinor: 0, currency: 'NGN', raw: { simulator: true, known: false } };
    return { status: o.status, amountMinor: o.amountMinor, currency: o.currency, paidAt: o.paidAt, channel: 'simulator', raw: { simulator: true, ...o } };
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = headerValue(headers['x-avn-simulator-signature']);
    return !!sig && safeHexEqual(hmac512(this.signingSecret, rawBody), sig);
  }

  parseWebhook(body: unknown): WebhookEvent {
    const b = body as { event?: string; data?: { id?: string; reference?: string } };
    return { eventKey: `${b.event}:${b.data?.id}`, type: b.event ?? 'unknown', reference: b.data?.reference, raw: body };
  }

  async refund(reference: string) {
    const o = this.outcomes.get(reference);
    if (o) this.outcomes.set(reference, { ...o, status: 'failed' });
    return { status: 'processed' as const, raw: { simulator: true } };
  }
}

/** DEVELOPMENT SIMULATOR for payouts. Transfers succeed unless the account ends in 0000 (to exercise failure paths). */
export class SimulatorPayoutProvider implements PayoutProvider {
  readonly name = 'simulator';
  async listBanks(): Promise<Bank[]> {
    return [
      { name: 'Access Bank (simulated)', code: '044' },
      { name: 'GTBank (simulated)', code: '058' },
      { name: 'First Bank (simulated)', code: '011' },
      { name: 'Zenith Bank (simulated)', code: '057' },
      { name: 'Opay (simulated)', code: '999992' },
    ];
  }
  async createRecipient(input: { name: string; accountNumber: string; bankCode: string }) {
    return { recipientCode: `SIMRCP_${input.bankCode}_${input.accountNumber.slice(-4)}` };
  }
  async transfer(input: { amountMinor: number; recipientCode: string; reference: string; reason: string }) {
    const failed = input.recipientCode.endsWith('0000');
    return { status: failed ? ('failed' as const) : ('success' as const), providerReference: `SIMTRF_${input.reference}`, raw: { simulator: true } };
  }
}
