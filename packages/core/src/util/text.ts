export function truncateChars(input: string | null | undefined, max: number): string {
  if (!input) return '';
  return input.length <= max ? input : input.slice(0, max);
}
