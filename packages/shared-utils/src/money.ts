import Decimal from 'decimal.js';

/** Money is always handled as Decimal strings; floating point arithmetic is never used for amounts. */
export type MoneyString = string;

export function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function addMoney(...values: Decimal.Value[]): string {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0)).toFixed(2);
}

/** Converts major units (e.g. naira) to minor units (kobo) as an integer, as payment providers require. */
export function toMinorUnits(value: Decimal.Value): number {
  return new Decimal(value).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fromMinorUnits(minor: number | string): string {
  return new Decimal(minor).dividedBy(100).toFixed(2);
}

export function formatMoney(value: Decimal.Value, currency = 'NGN', locale = 'en-NG'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(
    new Decimal(value).toNumber(),
  );
}

export { Decimal };
