export function formatSequence(seq: number): string {
  return `#${seq.toString().padStart(4, '0')}`;
}

export function formatTimestamp(isoString: string): string {
  if (!isoString) return '--:--:--';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function formatShortDate(isoString: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

export function truncateText(str: string, maxLen = 100): string {
  if (!str || str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}...`;
}
