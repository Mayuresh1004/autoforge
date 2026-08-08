/** Pure HTML helpers shared by the crawler, fingerprinter and discoverer. */

/** Strip tags/scripts/styles and collapse whitespace for fingerprinting. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract same-document hrefs (no anchors / mailto / tel). */
export function extractHrefs(html: string): readonly string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    if (
      href.length === 0 ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      href.startsWith('data:')
    ) {
      continue;
    }
    out.push(href);
  }
  return out;
}

/** Extract action/method/inputs of every `<form>` in the markup. */
export function extractForms(
  html: string,
): readonly { action: string; method: 'GET' | 'POST'; inputs: readonly string[] }[] {
  const forms: { action: string; method: 'GET' | 'POST'; inputs: string[] }[] = [];
  const re = /<form[\s\S]*?<\/form>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const form = m[0];
    const actionMatch = /<form[^>]*\baction\s*=\s*["']([^"']*)["']/i.exec(form);
    const methodMatch = /<form[^>]*\bmethod\s*=\s*["']([^"']*)["']/i.exec(form);
    const inputs: string[] = [];
    const inputRe =
      /<input[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*(?:type=["'](?:submit|hidden|button)["'])?/gi;
    let im: RegExpExecArray | null;
    while ((im = inputRe.exec(form)) !== null) {
      // Skip submit/hidden/button inputs by checking type present.
      const tag = im[0];
      if (/type=["'](submit|hidden|button|image)["']/i.test(tag)) continue;
      inputs.push(im[1]);
    }
    forms.push({
      action: actionMatch ? actionMatch[1] : '',
      method: methodMatch && methodMatch[1].toUpperCase() === 'POST' ? 'POST' : 'GET',
      inputs,
    });
  }
  return forms;
}

/** Detect WebSocket connection points in page markup/scripts. */
export function extractWebsocketHints(html: string): readonly string[] {
  const hints: string[] = [];
  const re = /(wss?:\/\/[^\s"'<>]+|new\s+WebSocket\s*\(\s*["'][^"']+["']|socket\.io[^\s"'<>]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) hints.push(m[0]);
  return hints;
}

const STATIC_EXT_RE =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|map|pdf|zip|gz|mp[34]|webm)$/i;

/** True for file assets that are not browsable pages. */
export function isStaticAssetUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return STATIC_EXT_RE.test(pathname);
  } catch {
    return false;
  }
}