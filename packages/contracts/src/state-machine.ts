import type { FinalOutcome, RequestStatus } from './enums';

/**
 * Legal verification-request transitions. Every status change in the API goes through
 * `assertTransition`; arbitrary status updates are impossible by construction.
 */
const CANCELLABLE: RequestStatus[] = ['CANCELLED'];
export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  CREATED: ['AWAITING_APPLICANT', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE, 'EXPIRED'],
  AWAITING_APPLICANT: ['READY_FOR_ASSIGNMENT', ...CANCELLABLE, 'EXPIRED'],
  READY_FOR_ASSIGNMENT: ['DISPATCHING', 'ASSIGNED', ...CANCELLABLE, 'EXPIRED'],
  DISPATCHING: ['ACCEPTED', 'ASSIGNED', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE, 'EXPIRED'],
  ASSIGNED: ['ACCEPTED', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE],
  ACCEPTED: ['EN_ROUTE', 'ARRIVED', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE],
  EN_ROUTE: ['ARRIVED', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE],
  ARRIVED: ['VISIT_IN_PROGRESS', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE],
  VISIT_IN_PROGRESS: ['EVIDENCE_SUBMITTED', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE],
  EVIDENCE_SUBMITTED: ['PROCESSING'],
  PROCESSING: ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'MANUAL_REVIEW'],
  MANUAL_REVIEW: ['COMPLETED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'READY_FOR_ASSIGNMENT', ...CANCELLABLE],
  // Final states can only be reopened into manual review (e.g. an upheld dispute).
  COMPLETED: ['MANUAL_REVIEW'],
  PARTIALLY_VERIFIED: ['MANUAL_REVIEW'],
  NOT_VERIFIED: ['MANUAL_REVIEW'],
  INCONCLUSIVE: ['MANUAL_REVIEW'],
  CANCELLED: [],
  EXPIRED: [],
};

export const FINAL_REQUEST_STATUSES: readonly RequestStatus[] = [
  'COMPLETED',
  'PARTIALLY_VERIFIED',
  'NOT_VERIFIED',
  'INCONCLUSIVE',
  'CANCELLED',
  'EXPIRED',
];

/** Statuses during which a field verifier holds the job. */
export const FIELD_ACTIVE_STATUSES: readonly RequestStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'VISIT_IN_PROGRESS'];

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: RequestStatus,
    public readonly to: RequestStatus,
  ) {
    super(`Illegal verification status transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export const canTransition = (from: RequestStatus, to: RequestStatus) => REQUEST_TRANSITIONS[from].includes(to);

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function statusForOutcome(outcome: FinalOutcome): RequestStatus {
  switch (outcome) {
    case 'VERIFIED':
      return 'COMPLETED';
    case 'PARTIALLY_VERIFIED':
      return 'PARTIALLY_VERIFIED';
    case 'NOT_VERIFIED':
      return 'NOT_VERIFIED';
    case 'INCONCLUSIVE':
      return 'INCONCLUSIVE';
    case 'MANUAL_REVIEW':
      return 'MANUAL_REVIEW';
  }
}

/** Applicant-facing timeline (spec A6) derived from the internal state machine. */
export const TIMELINE_STEPS = [
  { key: 'created', label: 'Request created' },
  { key: 'submitted', label: 'Applicant submission completed' },
  { key: 'waiting', label: 'Waiting for verifier' },
  { key: 'assigned', label: 'Verifier assigned' },
  { key: 'visit', label: 'Visit started' },
  { key: 'evidence', label: 'Evidence submitted' },
  { key: 'review', label: 'Under review' },
  { key: 'completed', label: 'Completed' },
] as const;
export type TimelineKey = (typeof TIMELINE_STEPS)[number]['key'];

const STATUS_TIMELINE_INDEX: Record<RequestStatus, number> = {
  CREATED: 0,
  AWAITING_APPLICANT: 0,
  READY_FOR_ASSIGNMENT: 2,
  DISPATCHING: 2,
  ASSIGNED: 3,
  ACCEPTED: 3,
  EN_ROUTE: 3,
  ARRIVED: 4,
  VISIT_IN_PROGRESS: 4,
  EVIDENCE_SUBMITTED: 5,
  PROCESSING: 6,
  MANUAL_REVIEW: 6,
  COMPLETED: 7,
  PARTIALLY_VERIFIED: 7,
  NOT_VERIFIED: 7,
  INCONCLUSIVE: 7,
  CANCELLED: -1,
  EXPIRED: -1,
};
export const timelineIndex = (status: RequestStatus) => STATUS_TIMELINE_INDEX[status];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  CREATED: 'Created',
  AWAITING_APPLICANT: 'Awaiting applicant',
  READY_FOR_ASSIGNMENT: 'Ready for assignment',
  DISPATCHING: 'Finding a verifier',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Verifier accepted',
  EN_ROUTE: 'Verifier en route',
  ARRIVED: 'Verifier arrived',
  VISIT_IN_PROGRESS: 'Visit in progress',
  EVIDENCE_SUBMITTED: 'Evidence submitted',
  PROCESSING: 'Processing',
  MANUAL_REVIEW: 'Manual review',
  COMPLETED: 'Verified',
  PARTIALLY_VERIFIED: 'Partially verified',
  NOT_VERIFIED: 'Not verified',
  INCONCLUSIVE: 'Inconclusive',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};
