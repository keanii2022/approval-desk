// Money is whole cents everywhere (2400 = $24.00). These two turn cents into
// dollars for people, and what a person types back into cents.

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

// "150", "150.5", "$1,200.00" -> cents. Anything else (empty, zero, negative,
// three decimals, words) -> null. Never rounds: "12.345" is refused, not guessed.
// A comma is only accepted as a thousands separator: "1,50" is refused, because
// it could mean $1.50 or $150, and a payment can't be undone.
export function parseDollars(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "");
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.replace(/,/g, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
