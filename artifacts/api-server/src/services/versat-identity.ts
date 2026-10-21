// The desktop importer expects a compact number; display/PDF numbers stay unchanged.
export function facNumber(number: string): string {
  return number.replaceAll("-", "");
}

export function facFilename(number: string): string {
  return `B${facNumber(number)}.Fac`;
}

// User-confirmed correction of the original 2026 talon, not a general ID formula.
export function facTalon(talon: string | null): string | null {
  return talon === "1005" ? "5" : talon;
}
