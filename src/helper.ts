import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getPathRelativeToProjectRoot(relativePath: string): string {
    return join(__dirname, '..', relativePath);
}

/**
 * Formats a message replacing all patterns like '{name}' with params[name].
 * @param message the message to format
 * @param params the object mapping parameter names with the value to put in the message
 */
export function format(message: string, params: Record<string, string>): string {
    return message.replace(/\${([^}]*)}/g, (r, k) => params[k]);
}