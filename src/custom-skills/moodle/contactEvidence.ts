/** Read explicit mailto recipients as evidence; never execute a URI or its headers. */
export function mailtoAddresses(value: string): string[] {
  if (!/^mailto:/i.test(value)) return [];
  try {
    const recipients = decodeURIComponent(value.slice(7).split(/[?#]/, 1)[0]!);
    return recipients.split(",").map(address => address.trim()).filter(address =>
      /^[^\s<>(),;:"\\\x00-\x1f\x7f@]+@[^\s<>(),;:"\\\x00-\x1f\x7f@]+\.[^\s<>(),;:"\\\x00-\x1f\x7f@]+$/.test(address),
    );
  } catch { return []; }
}
