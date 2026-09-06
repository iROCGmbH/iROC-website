export interface TrainingAvailabilityRecord {
  date: string;
  isActive: boolean;
  registeredCount: number;
  maxParticipants: number;
}

/**
 * A training date is selectable on the public website only when it is active,
 * has capacity, and is more than 21 days away. Keep this rule shared by the
 * authenticated portal and the public registration endpoint.
 */
export function isTrainingDateAvailable(
  trainingDate: TrainingAvailabilityRecord,
  now = new Date(),
): boolean {
  if (!trainingDate.isActive || trainingDate.maxParticipants <= trainingDate.registeredCount) {
    return false;
  }

  const date = new Date(`${trainingDate.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const registrationCutoff = new Date(now);
  registrationCutoff.setDate(registrationCutoff.getDate() + 21);

  return date > registrationCutoff;
}