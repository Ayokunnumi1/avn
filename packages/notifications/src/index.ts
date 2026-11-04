/**
 * Channel adapters for the central notification service (spec Part 11).
 * Delivery is queued (BullMQ) and tracked per attempt in NotificationDelivery.
 * Console adapters are development-only and refused in production by @avn/config.
 */
export interface SendResult {
  providerMessageId?: string;
}
export interface SmsProvider {
  readonly name: string;
  send(to: string, text: string): Promise<SendResult>;
}
export interface EmailProvider {
  readonly name: string;
  send(input: { to: string; subject: string; text: string; html?: string }): Promise<SendResult>;
}
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}
export interface PushProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<SendResult>;
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

/** DEVELOPMENT ONLY — writes the message to the log instead of sending it. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  constructor(private readonly log: LogFn) {}
  async send(to: string, text: string): Promise<SendResult> {
    this.log({ channel: 'sms', to, text }, '[DEV SMS SIMULATOR] message not sent to a real phone');
    return { providerMessageId: `console-${Date.now()}` };
  }
}

/** Termii (Nigeria) SMS API. */
export class TermiiSmsProvider implements SmsProvider {
  readonly name = 'termii';
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly baseUrl = 'https://api.ng.termii.com',
  ) {}
  async send(to: string, text: string): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.replace(/^\+/, ''), from: this.senderId, sms: text, type: 'plain', channel: 'generic', api_key: this.apiKey }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new DeliveryError('Termii unreachable', true);
    }
    const json = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
    if (!res.ok) throw new DeliveryError(json.message ?? `Termii HTTP ${res.status}`, res.status >= 500);
    return { providerMessageId: json.message_id };
  }
}

/** DEVELOPMENT ONLY — logs emails. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  constructor(private readonly log: LogFn) {}
  async send(input: { to: string; subject: string; text: string }): Promise<SendResult> {
    this.log({ channel: 'email', to: input.to, subject: input.subject, text: input.text }, '[DEV EMAIL SIMULATOR] email not sent');
    return { providerMessageId: `console-${Date.now()}` };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transport: Promise<{ sendMail(o: Record<string, unknown>): Promise<{ messageId: string }> }>;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = import('nodemailer').then((m) => m.default.createTransport(smtpUrl));
  }
  async send(input: { to: string; subject: string; text: string; html?: string }): Promise<SendResult> {
    try {
      const t = await this.transport;
      const info = await t.sendMail({ from: this.from, to: input.to, subject: input.subject, text: input.text, html: input.html });
      return { providerMessageId: info.messageId };
    } catch (err) {
      throw new DeliveryError(err instanceof Error ? err.message : 'SMTP error', true);
    }
  }
}

type WebPushLib = typeof import('web-push');

/** Web Push (VAPID). Disabled when keys are not configured. */
export class WebPushProvider implements PushProvider {
  readonly name = 'web-push';
  readonly enabled: boolean;
  private lib?: Promise<WebPushLib>;
  constructor(
    private readonly publicKey?: string,
    private readonly privateKey?: string,
    private readonly subject = 'mailto:ops@avn.local',
  ) {
    this.enabled = !!publicKey && !!privateKey;
    if (this.enabled) {
      this.lib = import('web-push').then((mod) => {
        const m = ((mod as WebPushLib & { default?: WebPushLib }).default ?? mod) as WebPushLib;
        m.setVapidDetails(this.subject, this.publicKey!, this.privateKey!);
        return m;
      });
    }
  }
  async send(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<SendResult> {
    if (!this.lib) throw new DeliveryError('Web push is not configured', false);
    const wp = await this.lib;
    try {
      await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600 });
      return {};
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      throw new DeliveryError(`Push failed (${status})`, status >= 500);
    }
  }
}

/** Minimal, escape-safe {{variable}} template rendering. Unknown variables render as empty strings. */
export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/**
 * Default templates. Copy is deliberately generic so lock-screen previews do not expose
 * sensitive details (addresses, outcomes, names) — the full content lives in-app.
 */
export const DEFAULT_TEMPLATES: Record<string, { title: string; body: string; sms?: string; emailSubject?: string }> = {
  'auth.otp': { title: 'Your AVN code', body: 'Your AVN verification code is {{code}}. It expires in 10 minutes. Never share it.', sms: 'AVN code: {{code}}. Expires in 10 min. Do not share.' },
  'applicant.invitation': {
    title: 'Address verification requested',
    body: '{{organisation}} has asked you to complete an address verification. Open: {{link}}',
    sms: '{{organisation}} requests your address verification on AVN: {{link}}',
    emailSubject: 'Complete your address verification',
  },
  'request.status': { title: 'Verification update', body: 'Your verification {{reference}} has an update. Open the app for details.' },
  'request.completed': { title: 'Verification complete', body: 'Verification {{reference}} is complete. Open the app to view the report.' },
  'verifier.job_offer': { title: 'New nearby job', body: 'A verification job ~{{minutes}} min walk away. Reward {{reward}}. Respond before it expires.' },
  'verifier.status': { title: 'Account update', body: 'Your verifier account status changed to {{status}}.' },
  'visit.confirmation_code': { title: 'Verifier at your address', body: 'Your AVN visit confirmation code is {{code}}. Share it only with the verifier at your door.', sms: 'AVN visit code: {{code}}. Share only with the verifier at your door.' },
  'payout.update': { title: 'Payout update', body: 'Your payout {{reference}} is now {{status}}.' },
  'org.status': { title: 'Organisation update', body: 'Your organisation account status is now {{status}}.' },
  'dispute.update': { title: 'Dispute update', body: 'Your dispute on {{reference}} has been updated.' },
  'review.required': { title: 'Review required', body: 'Verification {{reference}} needs manual review.' },
};
