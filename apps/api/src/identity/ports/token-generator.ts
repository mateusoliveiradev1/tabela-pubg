export interface TokenGenerator {
  id(): string;
  opaque(bytes: number): string;
  numericCode(length: number): string;
  digest(value: string): string;
}
