import log from './log.js';
import { Document, parseDocument, parse, YAMLMap } from 'yaml';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { getPathRelativeToProjectRoot } from './helper.js';

const logger = log();

interface ConfigSect {
    [key: string]: string | number | boolean | ConfigSect;
}

export class Config {
    private static readonly DEFAULT_CONFIG_FILE = getPathRelativeToProjectRoot('default_config.yml');
    private static readonly CONFIG_FILE = getPathRelativeToProjectRoot('config.yml');

    private readonly _root: string[];
    private readonly _doc: Document;

    constructor(base?: Config, sectionKey?: string) {
        if (base && sectionKey) {
            this._root = [];
            this._root.push(...base._root);
            this._root.push(sectionKey);
            this._doc = base._doc;
        } else {
            if (!existsSync(Config.CONFIG_FILE)) {
                copyFileSync(Config.DEFAULT_CONFIG_FILE, Config.CONFIG_FILE);
                logger.info('Created config.yml, edit it and restart the bot');
                throw '';
            }

            const configFile = readFileSync(Config.CONFIG_FILE, 'utf8');
            this._root = [];
            this._doc = parseDocument(configFile);
        }
    }

    private getPath(key: string | string[]): string[] {
        const res: string[] = [];
        res.push(...this._root);
        if (typeof key === 'string') res.push(key);
        else res.push(...key);
        return res;
    }

    private getNode(key: string | string[]): unknown {
        return this._doc.getIn(this.getPath(key));
    }

    getString(key: string): string {
        const value = this.getNode(key);
        if (typeof value === 'string') {
            return value;
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    getStringIn(path: string[]): string {
        const value = this.getNode(path);
        if (typeof value === 'string') {
            return value;
        } else {
            throw TypeError(`Config value with key '${path.join('/')}' is of type '${typeof value}'`);
        }
    }

    getNumber(key: string): number {
        const value = this.getNode(key);
        if (typeof value === 'number') {
            return value;
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    getBoolean(key: string): boolean {
        const value = this.getNode(key);
        if (typeof value === 'boolean') {
            return value;
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    getSection(key: string): Config {
        const value = this.getNode(key);
        if (value instanceof YAMLMap) {
            return new Config(this, key);
        } else {
            throw TypeError(`Config value with key '${key}' is of type '${typeof value}'`);
        }
    }

    /**
     * Adds the value to the path and saves the changes to file.
     * @param path a string array representing the path where to add the value
     * @param value the value to be added
     */
    add(path: string[], value: unknown) {
        this._doc.addIn(this.getPath(path), value);
        writeFileSync(Config.CONFIG_FILE, this._doc.toString(), 'utf8');
    }

    remove(path: string[]) {
        this._doc.deleteIn(this.getPath(path));
        writeFileSync(Config.CONFIG_FILE, this._doc.toString(), 'utf8');
    }

    [Symbol.iterator]() {
        // We need to parse this from file each time to ensure that every change made from any
        // instance of Config (root and sections) is correctly reflected
        let obj = parse(readFileSync(Config.CONFIG_FILE, 'utf8'));
        for (const key of this._root) {
            obj = obj[key];
        }
        const keys = Object.keys(obj);
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