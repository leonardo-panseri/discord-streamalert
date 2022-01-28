import { getLogger } from './index.js';
import { Document, parse, parseDocument } from 'yaml';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { getPathRelativeToProjectRoot } from './helper.js';

const logger = getLogger();

interface ConfigSect {
    [key: string]: string | number | boolean | ConfigSect;
}

export class Config {
    private static readonly DEFAULT_CONFIG_FILE = getPathRelativeToProjectRoot('default_config.yml');
    private static readonly CONFIG_FILE = getPathRelativeToProjectRoot('config.yml');

    private readonly _root: ConfigSect;
    private readonly _doc: Document;

    constructor(base?: Config, sect?: ConfigSect) {
        if (base && sect) {
            this._root = sect;
            this._doc = base._doc;
        } else {
            if (!existsSync(Config.CONFIG_FILE)) {
                copyFileSync(Config.DEFAULT_CONFIG_FILE, Config.CONFIG_FILE);
                logger.info('Created config.yml, edit it and restart the bot');
                throw '';
            }

            const configFile = readFileSync(Config.CONFIG_FILE, 'utf8');
            this._root = parse(configFile);
            this._doc = parseDocument(configFile);
        }
    }

    getString(key: string): string {
        const value = this._root[key];
        if (typeof value === 'string') {
            return value;
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    getStringIn(path: string[]): string {
        const value = this._doc.getIn(path);
        if (typeof value === 'string') {
            return value;
        } else {
            throw TypeError(`Config value with key '${path.join('/')}' is of type '${typeof value}'`);
        }
    }

    getNumber(key: string): number {
        const value = this._root[key];
        if (typeof value === 'number') {
            return value;
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    getBoolean(key: string): boolean {
        const value = this._root[key];
        if (typeof value === 'boolean') {
            return value;
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    getSection(key: string): Config {
        const value = this._root[key];
        if (Config.isSection(value)) {
            return new Config(this, value);
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    private static isSection(obj: string | number | boolean | ConfigSect): obj is ConfigSect {
        return !!(obj && typeof obj !== 'string' && typeof obj !== 'number' && typeof obj !== 'boolean');
    }

    /**
     * Adds the value to the path and saves the changes to file.
     * @param path a string array representing the path where to add the value
     * @param value the value to be added
     */
    add(path: string[], value: unknown) {
        this._doc.addIn(path, value);
        writeFileSync(Config.CONFIG_FILE, this._doc.toString(), 'utf8');
    }

    [Symbol.iterator]() {
        const keys = Object.keys(this._root);
        let i = 0;
        return {
            next() {
                if (i < keys.length) {
                    const current = keys[i];
                    i++;
                    return { value: current, done: false };
                } else {
                    return { done: true };
                }
            },
        };
    }
}