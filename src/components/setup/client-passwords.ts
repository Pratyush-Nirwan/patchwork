export function generateClientSystemPassword(name?: string): string {
  const raw = (name || "").trim();
  const asciiOnly = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s]/g, "")
    .trim();

  const words = asciiOnly.split(/\s+/).filter(Boolean);
  const firstName = words[0] || "User";
  let lastNameInitial = "";
  if (words.length > 1) {
    lastNameInitial = words[1][0].toUpperCase();
  } else if (firstName.length > 1) {
    lastNameInitial = firstName[firstName.length - 1].toUpperCase();
  } else {
    lastNameInitial = "X";
  }

  let formattedFirst =
    firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

  if (formattedFirst.length < 2) {
    formattedFirst = `${formattedFirst}x`;
  }

  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const digits = (1000 + (array[0] % 9000)).toString();
  return `${formattedFirst}${lastNameInitial}@${digits}`;
}

export function generateClientCryptoPassword(length = 16): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = uppercase + lowercase + digits + symbols;

  const getRandomChar = (str: string) => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return str[arr[0] % str.length];
  };

  const required = [
    getRandomChar(uppercase),
    getRandomChar(lowercase),
    getRandomChar(digits),
    getRandomChar(symbols),
  ];

  const remaining: string[] = [];
  for (let i = 0; i < length - required.length; i++) {
    remaining.push(getRandomChar(all));
  }

  const combined = [...required, ...remaining];
  for (let i = combined.length - 1; i > 0; i--) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const j = arr[0] % (i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");
}
