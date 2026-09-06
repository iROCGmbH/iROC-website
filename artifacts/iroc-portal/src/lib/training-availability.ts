import type { PortalTrainingDate } from '@workspace/api-client-react';

/**
 * Keep the doctor-facing occasion list limited to dates that can actually be
 * selected. The API is authoritative, but this also protects the UI from
 * rendering a stale or partially updated response.
 */
export function filterAvailableTrainingDates(
  dates: readonly PortalTrainingDate[],
): PortalTrainingDate[] {
  return dates.filter(date => date.isAvailable);
}