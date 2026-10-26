export const VERSAT_CONFIRMATION_WARNING_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function settlementConfirmationAge(paidOn: string, now = new Date()) {
  const paidOnTime = Date.parse(`${paidOn}T00:00:00Z`);
  const todayTime = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const confirmationAgeDays = Math.max(0, Math.floor((todayTime - paidOnTime) / MS_PER_DAY));

  return {
    confirmationAgeDays,
    confirmationOverdue: confirmationAgeDays >= VERSAT_CONFIRMATION_WARNING_DAYS,
  };
}
