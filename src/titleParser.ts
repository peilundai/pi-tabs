import { DEFAULT_TITLE_LENGTH, EXTENSION_NAME } from "./constants";

// OSC title messages are delimited by terminal control characters.
// eslint-disable-next-line no-control-regex
const OSC_TITLE = /\u001b\][012];([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;

export function compactTitle(
  value: string,
  maximumLength = DEFAULT_TITLE_LENGTH,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximumLength - 1))}…`;
}

export function titleFromPiOsc(
  payload: string,
  maximumLength = DEFAULT_TITLE_LENGTH,
): string | undefined {
  const normalized = compactTitle(payload, Number.MAX_SAFE_INTEGER);
  const parts = normalized.split(" - ");
  if (!isPiHeading(parts[0] ?? "")) {
    return undefined;
  }
  if (parts.length < 3) {
    return EXTENSION_NAME;
  }
  const sessionTitle = parts.slice(1, -1).join(" - ").trim();
  return sessionTitle ? compactTitle(sessionTitle, maximumLength) : EXTENSION_NAME;
}

/**
 * Extracts OSC 0/1/2 titles from a stream and retains only a trailing partial
 * escape sequence. Non-title terminal output never accumulates in memory.
 */
export function consumeOscTitles(
  chunk: string,
  carry = "",
): { payloads: readonly string[]; carry: string } {
  const buffer = carry + chunk;
  const payloads: string[] = [];
  let match: RegExpExecArray | null;
  let consumedThrough = 0;
  OSC_TITLE.lastIndex = 0;
  while ((match = OSC_TITLE.exec(buffer))) {
    payloads.push(match[1]);
    consumedThrough = match.index + match[0].length;
  }

  const remainder = buffer.slice(consumedThrough);
  const possibleStart = remainder.lastIndexOf("\u001b]");
  const nextCarry =
    possibleStart >= 0
      ? remainder.slice(possibleStart, possibleStart + 8192)
      : remainder.endsWith("\u001b")
        ? "\u001b"
        : "";
  return { payloads, carry: nextCarry };
}

function isPiHeading(value: string): boolean {
  return value === "π" || /^(?:pi|pi coding agent)$/i.test(value);
}
