function base32InfohashToHex(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let bitCount = 0;
  let hex = "";

  for (const char of value.toUpperCase()) {
    const digit = alphabet.indexOf(char);
    if (digit === -1) return null;
    bits = (bits << 5) | digit;
    bitCount += 5;
    while (bitCount >= 8) {
      bitCount -= 8;
      hex += ((bits >> bitCount) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return bitCount === 0 && hex.length === 40 ? hex : null;
}

export function extractInfohash(magnetUrl) {
  try {
    const parsed = new URL(magnetUrl);
    if (parsed.protocol !== "magnet:") return null;
    for (const [key, xt] of parsed.searchParams) {
      if (key.toLowerCase() !== "xt") continue;
      const match = xt.match(/^urn:btih:([a-zA-Z0-9]+)$/i);
      if (!match) continue;
      const value = match[1];
      if (/^[a-f\d]{40}$/i.test(value)) return value.toLowerCase();
      if (/^[a-z2-7]{32}$/i.test(value)) {
        const decoded = base32InfohashToHex(value);
        if (decoded) return decoded;
      }
    }
    return null;
  } catch {
    return null;
  }
}
