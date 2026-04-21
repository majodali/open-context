/**
 * Load the Anthropic API key from `.anthropic.key` at the project root.
 *
 * Falls back to the ANTHROPIC_API_KEY environment variable if the file is
 * absent. Throws if neither is available.
 *
 * The key file is gitignored (see .gitignore). Do not commit it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface LoadKeyOptions {
  /** Path to the key file (default: .anthropic.key at project root). */
  path?: string;
  /** Whether to fall back to ANTHROPIC_API_KEY env var. Default: true */
  envFallback?: boolean;
}

/**
 * Read the Anthropic API key from disk or env.
 * Whitespace (including newlines) is trimmed.
 */
export function loadAnthropicKey(options: LoadKeyOptions = {}): string {
  const path = options.path ?? resolve(process.cwd(), '.anthropic.key');
  const envFallback = options.envFallback !== false;

  if (existsSync(path)) {
    const key = readFileSync(path, 'utf-8').trim();
    if (!key) {
      throw new Error(
        `Key file ${path} exists but is empty. Remove the file or write a valid API key to it.`,
      );
    }
    return key;
  }

  if (envFallback && process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  throw new Error(
    `No Anthropic API key found. Create ${path} with your key, or set ANTHROPIC_API_KEY.`,
  );
}
