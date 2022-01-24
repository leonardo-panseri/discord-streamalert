import { logger } from './index.js';
import { parse } from 'yaml';
import { existsSync, copyFileSync, readFileSync } from 'fs';
import { getPathRelativeToProjectRoot } from './helper.js';

const DEFAULT_CONFIG_FILE = getPathRelativeToProjectRoot('default_config.yml');
const CONFIG_FILE = getPathRelativeToProjectRoot('config.yml');

export function load(): object {
    if (!existsSync(CONFIG_FILE)) {
        copyFileSync(DEFAULT_CONFIG_FILE, CONFIG_FILE);
        logger.info('Created config.yml, edit it and restart the bot');
        return null;
    }

    const configFile = readFileSync(CONFIG_FILE, 'utf8');
    return parse(configFile);
}