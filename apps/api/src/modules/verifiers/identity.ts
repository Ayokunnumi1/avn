import { deps } from '../../container';

/**
 * Identity verification provider adapter (spec B1). Results are recorded as-is; a PASSED
 * check still requires administrative approval before any paid assignment.
 */
export interface IdentityCheckInput {
  idType: string;
  idNumber: string;
  fullName: string;
  dateOfBirth: string;
}
export interface IdentityCheckResult {
  status: 'PASSED' | 'FAILED' | 'MANUAL_REVIEW' | 'ERROR';
  providerReference?: string;
  summary: Record<string, unknown>;
}
export interface IdentityProvider {
  readonly name: string;
  check(input: IdentityCheckInput): Promise<IdentityCheckResult>;
}

/** Default: no automated check — an administrator reviews the uploaded ID document and selfie. */
export class ManualIdentityProvider implements IdentityProvider {
  readonly name = 'manual';
  async check(): Promise<IdentityCheckResult> {
    return { status: 'MANUAL_REVIEW', summary: { note: 'Queued for administrator document review' } };
  }
}

/**
 * DEVELOPMENT SIMULATOR — refused when APP_ENV=production (see @avn/config).
 * ID numbers starting with 9999 simulate a failed match.
 */
export class SimulatorIdentityProvider implements IdentityProvider {
  readonly name = 'simulator';
  async check(input: IdentityCheckInput): Promise<IdentityCheckResult> {
    const failed = input.idNumber.startsWith('9999');
    return {
      status: failed ? 'FAILED' : 'PASSED',
      providerReference: `SIM-${Date.now()}`,
      summary: { simulator: true, nameMatch: !failed, dobMatch: !failed, note: 'Development simulator result — not a real identity check' },
    };
  }
}

export function identityProvider(): IdentityProvider {
  return deps().env.IDENTITY_PROVIDER === 'simulator' ? new SimulatorIdentityProvider() : new ManualIdentityProvider();
}
