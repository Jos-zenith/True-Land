/**
 * Canonical currency table (ISO 4217). `decimals` is the ISO minor-unit exponent and is the ONLY
 * source of currency precision for validating amounts. Provider availability is recorded separately
 * (currency_metadata.provider_availability), because providers do not all support the same currencies.
 */
export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  countries: string[];
}

const C = (code: string, name: string, symbol: string, decimals: number, countries: string[]): CurrencyInfo => ({ code, name, symbol, decimals, countries });

export const CURRENCIES: readonly CurrencyInfo[] = [
  C("USD", "US dollar", "$", 2, ["US"]),
  C("MXN", "Mexican peso", "$", 2, ["MX"]),
  C("INR", "Indian rupee", "₹", 2, ["IN"]),
  C("EUR", "Euro", "€", 2, ["DE", "FR", "ES", "IT", "NL", "IE", "PT", "BE", "AT", "FI"]),
  C("GBP", "Pound sterling", "£", 2, ["GB"]),
  C("CAD", "Canadian dollar", "$", 2, ["CA"]),
  C("AUD", "Australian dollar", "$", 2, ["AU"]),
  C("NZD", "New Zealand dollar", "$", 2, ["NZ"]),
  C("CHF", "Swiss franc", "CHF", 2, ["CH", "LI"]),
  C("JPY", "Japanese yen", "¥", 0, ["JP"]),
  C("KRW", "South Korean won", "₩", 0, ["KR"]),
  C("CNY", "Chinese yuan", "¥", 2, ["CN"]),
  C("HKD", "Hong Kong dollar", "$", 2, ["HK"]),
  C("SGD", "Singapore dollar", "$", 2, ["SG"]),
  C("BRL", "Brazilian real", "R$", 2, ["BR"]),
  C("COP", "Colombian peso", "$", 2, ["CO"]),
  C("CLP", "Chilean peso", "$", 0, ["CL"]),
  C("PEN", "Peruvian sol", "S/", 2, ["PE"]),
  C("ARS", "Argentine peso", "$", 2, ["AR"]),
  C("PHP", "Philippine peso", "₱", 2, ["PH"]),
  C("IDR", "Indonesian rupiah", "Rp", 2, ["ID"]),
  C("VND", "Vietnamese dong", "₫", 0, ["VN"]),
  C("THB", "Thai baht", "฿", 2, ["TH"]),
  C("MYR", "Malaysian ringgit", "RM", 2, ["MY"]),
  C("ZAR", "South African rand", "R", 2, ["ZA"]),
  C("NGN", "Nigerian naira", "₦", 2, ["NG"]),
  C("KES", "Kenyan shilling", "KSh", 2, ["KE"]),
  C("EGP", "Egyptian pound", "£", 2, ["EG"]),
  C("PKR", "Pakistani rupee", "₨", 2, ["PK"]),
  C("BDT", "Bangladeshi taka", "৳", 2, ["BD"]),
  C("TRY", "Turkish lira", "₺", 2, ["TR"]),
  C("ILS", "Israeli new shekel", "₪", 2, ["IL"]),
  C("AED", "UAE dirham", "د.إ", 2, ["AE"]),
  C("SAR", "Saudi riyal", "﷼", 2, ["SA"]),
  C("PLN", "Polish złoty", "zł", 2, ["PL"]),
  C("CZK", "Czech koruna", "Kč", 2, ["CZ"]),
  C("HUF", "Hungarian forint", "Ft", 2, ["HU"]),
  C("SEK", "Swedish krona", "kr", 2, ["SE"]),
  C("NOK", "Norwegian krone", "kr", 2, ["NO"]),
  C("DKK", "Danish krone", "kr", 2, ["DK"]),
  C("ISK", "Icelandic króna", "kr", 0, ["IS"]),
  C("UGX", "Ugandan shilling", "USh", 0, ["UG"]),
  C("BHD", "Bahraini dinar", ".د.ب", 3, ["BH"]),
  C("KWD", "Kuwaiti dinar", "د.ك", 3, ["KW"]),
  C("JOD", "Jordanian dinar", "د.ا", 3, ["JO"]),
  C("OMR", "Omani rial", "ر.ع.", 3, ["OM"]),
  C("TND", "Tunisian dinar", "د.ت", 3, ["TN"]),
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyInfo(code: string): CurrencyInfo | null {
  return BY_CODE.get(code.toUpperCase()) ?? null;
}

/** Validate a positive decimal amount against the currency's ISO precision. Returns an error message or null. */
export function amountProblem(amount: string, currency: string): string | null {
  const info = currencyInfo(currency);
  if (!info) return `${currency} is not a supported currency.`;
  if (!/^\d+(\.\d+)?$/.test(amount)) return "Amount must be a plain positive decimal number.";
  const dp = amount.split(".")[1]?.length ?? 0;
  if (dp > info.decimals) return `${currency} amounts have at most ${info.decimals} decimal place${info.decimals === 1 ? "" : "s"}.`;
  if (/^0+(\.0+)?$/.test(amount)) return "Amount must be greater than zero.";
  return null;
}
