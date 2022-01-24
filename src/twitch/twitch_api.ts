import { logger } from '../index.js';
import fetch from 'node-fetch';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getPathRelativeToProjectRoot } from '../helper.js';

const BASE_OAUTH2_URL = 'https://id.twitch.tv/oauth2';
const BASE_HELIX_URL = 'https://api.twitch.tv/helix';
const urls = {
    'TOKEN': BASE_OAUTH2_URL + '/token',
    'VALIDATE': BASE_OAUTH2_URL + '/validate',
    'USERS': BASE_HELIX_URL + '/users',
    'EVENTSUB': BASE_HELIX_URL + '/eventsub/subscriptions',
};

const dataFile = getPathRelativeToProjectRoot('api_data.json');

function getUrlWithParams(url: string, params: Record<string, string>): string {
    return url + '?' + new URLSearchParams(params);
}

export class TwitchAPI {
    private readonly _clientID: string;
    private readonly _clientSecret: string;
    private readonly _callbackBaseUrl: string;
    private readonly _callbackSecret: string;

    private _data: object;

    constructor(clientID, clientSecret, callbackBaseUrl, callbackSecret) {
        this._clientID = clientID;
        this._clientSecret = clientSecret;
        this._callbackBaseUrl = callbackBaseUrl;
        this._callbackSecret = callbackSecret;

        this.loadData();
    }

    private loadData() {
        if (!existsSync(dataFile)) {
            this._data = { 'app_token': '', 'subscriptions': {} };
            this.saveData();
            return;
        }
        this._data = JSON.parse(readFileSync(dataFile, 'utf8'));
    }

    private saveData() {
        writeFileSync(dataFile, JSON.stringify(this._data), 'utf8');
    }

    private static async validateAppToken(token): Promise<boolean> {
        const res = await fetch(urls.VALIDATE, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        return res.ok;
    }

    private async getAppToken(): Promise<string> {
        const cachedToken: string = this._data['app_token'];
        if (cachedToken !== '') {
            const valid = await TwitchAPI.validateAppToken(cachedToken);
            if (valid) {
                return cachedToken;
            }
        }

        const params = {
            'client_id': this._clientID,
            'client_secret': this._clientSecret,
            'grant_type': 'client_credentials' };
        const res = await fetch(getUrlWithParams(urls.TOKEN, params), {
            method: 'post',
        });
        if (res.ok) {
            const json = await res.json();
            const token = json['access_token'];
            this._data['app_token'] = token;
            this.saveData();
            return token;
        } else {
            throw `Request to generate App Token failed with code ${res.status}"`;
        }
    }

    private async getUserID(appToken: string, username: string): Promise<string> {
        const headers: HeadersInit = {
            'Authorization': `Bearer ${appToken}`,
            'Client-Id': this._clientID };
        const res = await fetch(getUrlWithParams(urls.USERS, { 'login': username }), {
            headers: headers,
        });
        if (res.ok) {
            const json = await res.json();
            return json['data'][0]['id'];
        } else {
            throw `Request to get user '${username}' failed with code ${res.status}"`;
        }
    }

    private async getSubscriptionStatus(appToken: string, type: string, subscriptionID: string): Promise<string> {
        const headers: HeadersInit = {
            'Authorization': `Bearer ${appToken}`,
            'Client-Id': this._clientID };
        let paginationCursor = undefined;
        do {
            const params = paginationCursor === undefined ? { 'type': type } : { 'type': type, 'after': paginationCursor };
            const url = getUrlWithParams(urls.EVENTSUB, params);

            const res = await fetch(url, {
                headers: headers,
            });
            if (res.ok) {
                const json = await res.json();
                const data = json['data'];
                data.forEach(sub => {

                    console.log(sub);

                    if (sub['id'] === subscriptionID) {
                        return sub['status'];
                    }
                });

                paginationCursor = res['pagination']['cursor'];
            } else {
                throw `Request to get EventSubs failed with code ${res.status}"`;
            }
        } while (paginationCursor !== undefined);

        return 'not_exists';
    }

    private async deleteSubscription(appToken: string, subscriptionID: string): Promise<void> {
        const headers: HeadersInit = {
            'Authorization': `Bearer ${appToken}`,
            'Client-Id': this._clientID };
        const res = await fetch(getUrlWithParams(urls.EVENTSUB, { 'id': subscriptionID }), {
            method: 'delete',
            headers: headers,
        });
        if (!res.ok) {
            throw `Request to delete EventSub ${subscriptionID} failed with code ${res.status}"`;
        }
    }

    private async subscribeToEvent(appToken: string, headers: HeadersInit, type: string, broadcasterID: string, callbackRelativeUrl: string): Promise<void> {
        if (this._data['subscriptions'][broadcasterID] !== undefined) {
            const cachedSubs = this._data['subscriptions'][broadcasterID];
            if (cachedSubs[type] !== undefined) {
                const subID = cachedSubs[type];
                const newStatus = await this.getSubscriptionStatus(appToken, type, subID);
                if (newStatus === 'enabled' || newStatus === 'webhook_callback_verification_pending') {
                    logger.info(`Cached sub is valid for '${broadcasterID}'`);
                    return;
                } else {
                    logger.warn(`Cached sub is invalid (${newStatus}) for '${broadcasterID}'`);
                    if (newStatus !== 'not_exists') await this.deleteSubscription(appToken, subID);
                    delete cachedSubs[type];
                    this.saveData();
                }
            }
        }

        const payload = new EventSubPayload(type, broadcasterID, this._callbackBaseUrl + callbackRelativeUrl,
            this._callbackSecret);
        console.log(JSON.stringify(payload));
        const res = await fetch(urls.EVENTSUB, {
            method: 'post',
            headers: headers,
            body: JSON.stringify(payload),
        });
        if (res.ok) {
            const json = await res.json();

            if (this._data['subscriptions'][broadcasterID] === undefined) {
                this._data['subscriptions'][broadcasterID] = {};
            }
            const cachedSubs = this._data['subscriptions'][broadcasterID];
            cachedSubs[type] = json['data'][0]['id'];
            this.saveData();

            logger.info(`Subscribed to '${type}' for '${broadcasterID}'`);
        } else {
            const errorMsg = res.text();
            throw `Request to subscribe to '${type}' for '${broadcasterID}' failed with code ${res.status}\n${errorMsg}`;
        }
    }

    async subscribeToStreamUpdates(broadcasterUsername: string): Promise<void> {
        const token = await this.getAppToken();

        const broadcasterID = await this.getUserID(token, broadcasterUsername);

        const headers: HeadersInit = {
            'Authorization': `Bearer ${token}`,
            'Client-Id': this._clientID,
            'Content-Type': 'application/json' };

        await this.subscribeToEvent(token, headers, 'stream.online', broadcasterID, '/online');
        await this.subscribeToEvent(token, headers, 'stream.offline', broadcasterID, '/offline');
        await this.subscribeToEvent(token, headers, 'channel.update', broadcasterID, '/update');
    }
}

class EventSubPayload {
    type: string;
    readonly version = '1';
    condition = {};
    transport = {
        'method': 'webhook' };

    constructor(type: string, broadcasterID: string, callbackUrl: string, callbackSecret: string) {
        this.type = type;
        this.condition['broadcaster_user_id'] = broadcasterID;
        this.transport['callback'] = callbackUrl;
        this.transport['secret'] = callbackSecret;
    }
}

