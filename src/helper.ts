import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getPathRelativeToProjectRoot(relativePath: string): string {
    return join(__dirname, '..', relativePath);
}