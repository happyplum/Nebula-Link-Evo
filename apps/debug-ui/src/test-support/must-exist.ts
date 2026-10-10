export function mustExist<T>(value: T | null | undefined, label = 'test value'): T {
  if (value === null || value === undefined) throw new Error(`${label} must exist`);
  return value;
}
