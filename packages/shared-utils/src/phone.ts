import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalises a phone number to E.164. The default country comes from configuration
 * (Country records), never hardcoded business rules.
 */
export function normalisePhone(input: string, defaultCountry: string = 'NG'): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export const maskPhone = (e164: string) => (e164.length > 7 ? `${e164.slice(0, 4)}•••${e164.slice(-3)}` : e164);
