import type { routes } from './lib/http';
import { adminRoutes } from './modules/admin/routes';
import { applicantRoutes, invitationRoutes } from './modules/applicants/routes';
import { fileRoutes, geoRoutes, notificationRoutes, publicRoutes } from './modules/common/routes';
import { assignmentRoutes } from './modules/field/routes';
import { publicApiRoutes } from './modules/integrations/public';
import { assistantRoutes } from './modules/organisations/assistant';
import { billingRoutes } from './modules/organisations/billing';
import { developerRoutes } from './modules/organisations/developers';
import { bulkRoutes, orgRequestRoutes } from './modules/organisations/requests';
import { orgRoutes } from './modules/organisations/routes';
import { paymentRoutes } from './modules/payments/routes';
import { reportRoutes } from './modules/reports/routes';
import { offerRoutes, verifierRoutes } from './modules/verifiers/routes';

type RouteGroup = ReturnType<typeof routes>;

/** Every module's route group, mounted under /api/v1 by app.ts. Order matters only for overlapping prefixes. */
export const allRoutes: RouteGroup[] = [
  applicantRoutes,
  invitationRoutes,
  verifierRoutes,
  offerRoutes,
  assignmentRoutes,
  orgRequestRoutes,
  bulkRoutes,
  billingRoutes,
  developerRoutes,
  assistantRoutes,
  orgRoutes,
  publicApiRoutes,
  paymentRoutes,
  reportRoutes,
  notificationRoutes,
  fileRoutes,
  geoRoutes,
  publicRoutes,
  adminRoutes,
];
