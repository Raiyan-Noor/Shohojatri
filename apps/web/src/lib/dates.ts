/** YYYY-MM-DD in Bangladesh, whatever the device's timezone. */
export function todayInBangladesh(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}

/** Completed months between two YYYY-MM-DD dates, as the API counts them (core/dates.py). */
export function ageInMonths(dob: string, today: string = todayInBangladesh()): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  return Math.max(months, 0);
}

/** An ISO timestamp as a `datetime-local` value in Bangladesh time ("2026-10-17T14:05"). */
export function toBdLocalInput(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  // sv-SE formats as "YYYY-MM-DD HH:mm:ss".
  return date
    .toLocaleString("sv-SE", { timeZone: "Asia/Dhaka", hour12: false })
    .slice(0, 16)
    .replace(" ", "T");
}

/** A `datetime-local` value read as Bangladesh time (UTC+6, no daylight saving) → ISO. */
export function fromBdLocalInput(value: string): string {
  return new Date(`${value}:00+06:00`).toISOString();
}
