import { useState } from 'react';
import { cn } from '../../utils/cn';

export interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = 'json', className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn('relative rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs', className)}>
      <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/50 px-3 py-1.5 text-zinc-400">
        <span className="text-[10px] uppercase font-semibold">{language}</span>
        <button
          onClick={handleCopy}
          className="text-[11px] hover:text-zinc-200 transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-zinc-300 leading-relaxed max-h-96">
        <code>{code}</code>
      </pre>
    </div>
  );
}
