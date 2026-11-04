/**
 * Importing this module registers every job handler. Both the API (inline mode) and the
 * worker process (queue mode) import it, so handlers are defined exactly once.
 */
import '../lib/notify';
import '../modules/integrations/webhooks';
import '../modules/assignments/dispatch';
import '../modules/field/evidence';
import '../modules/reports/service';
import '../modules/organisations/requests';
import '../modules/wallets/payouts';
import './maintenance';
import './ai-documents';

export { jobHandler, QUEUE_NAME, type JobName } from '../lib/jobs';
export { maintenanceTick } from './maintenance';
