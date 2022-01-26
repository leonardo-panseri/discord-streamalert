import { logger, dataFilePath } from '../index.js';
import fetch from 'node-fetch';
import Keyv from 'keyv';

/** Payload to send to subscribe to an event of the EventSub endpoint */
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

/** Manages interactions with the Twitch API */
export class TwitchApi {
    // Urls for the needed endpoints
    private static readonly BASE_OAUTH2_URL = 'https://id.twitch.tv/oauth2';
    private static readonly BASE_HELIX_URL = 'https://api.twitch.tv/helix';
    private static readonly urls = {
        'TOKEN': TwitchApi.BASE_OAUTH2_URL + '/token',
        'VALIDATE': TwitchApi.BASE_OAUTH2_URL + '/validate',
        'USERS': TwitchApi.BASE_HELIX_URL + '/users',
        'EVENTSUB': TwitchApi.BASE_HELIX_URL + '/eventsub/subscriptions',
        'STREAMS': TwitchApi.BASE_HELIX_URL + '/streams',
    };

    private readonly _clientId: string;
    private readonly _clientSecret: string;
    /** Url for the webapp that receives event notifications through webhooks */
    private readonly _callbackBaseUrl: string;
    /** Secret that is used to verify notification authenticity */
    private readonly _callbackSecret: string;

    private _cache: Keyv;

    constructor(clientId, clientSecret, callbackBaseUrl, callbackSecret) {
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._callbackBaseUrl = callbackBaseUrl;
        this._callbackSecret = callbackSecret;

        this._cache = new Keyv('sqlite://' + dataFilePath, { namespace: 'twitchApi' });
    }

    /**
     * Gets an url with encoded parameters.
     * @param url the base url
     * @param params an object containing the parameters to encode
     * @private
     */
    private static getUrlWithParams(url: string, params: Record<string, string>): string {
        return url + '?' + new URLSearchParams(params);
    }

    /**
     * Gets the headers needed by Twitch API.
     * @param options options
     * @param options.clientId if the client id should be in the headers (default: true)
     * @param options.json if the content type should be set to json (default: false)
     * @private
     */
    private getHeaders({ clientId = true, json = false } = {}): HeadersInit {
        const headers: HeadersInit = { 'Authorization': `Bearer ${this.getAppToken(false)}` };
        if (clientId) headers['Client-Id'] = this._clientId;
        if (json) headers['Content-Type'] = 'application/json';
        return headers;
    }

    /**
     * Checks if the app token is still valid.
     * @private
     */
    private async validateAppToken(): Promise<boolean> {
        const res = await fetch(TwitchApi.urls.VALIDATE, {
            headers: this.getHeaders({ clientId: false }),
        });
        return res.ok;
    }

    /**
     * Gets the app token, either from cache or by requesting a new one.
     * @param validate if the app token should be validated if it is present in cache (default: false)
     * @private
     */
    private async getAppToken(validate = false): Promise<string> {
        const cachedToken: string = await this._cache.get('appToken');
        if (cachedToken) {
            if (validate) {
                const valid = await this.validateAppToken();
                if (valid) {
                    return cachedToken;
                }
            } else {
                return cachedToken;
            }
        }

        const params = {
            'client_id': this._clientId,
            'client_secret': this._clientSecret,
            'grant_type': 'client_credentials' };
        const res = await this.makeApiCall(TwitchApi.getUrlWithParams(TwitchApi.urls.TOKEN, params), {
            method: 'post',
        });

        const token = res['access_token'];
        await this._cache.set('appToken', token);
        return token;
    }

    /**
     * Gets the id of the user, or undefined if not found
     * @param username the username of the user
     * @private
     */
    private async getUserID(username: string): Promise<string> {
        const url = TwitchApi.getUrlWithParams(TwitchApi.urls.USERS, { 'login': username });
        const res = await this.makeApiCall(url, {
            headers: this.getHeaders(),
        });
        if (!res['data'][0]) {
            logger.warn(`No user with username ${username}`);
            return undefined;
        }
        return res['data'][0]['id'];
    }

    /**
     * Gets the status of the given subscription, or 'not_exists' if not found.
     * @param type the type of the subscription
     * @param subscriptionID the id of the subscription
     * @private
     */
    private async getSubscriptionStatus(type: string, subscriptionID: string): Promise<string> {
        let paginationCursor = undefined;
        do {
            const params = paginationCursor === undefined ? { 'type': type } : { 'type': type, 'after': paginationCursor };
            const url = TwitchApi.getUrlWithParams(TwitchApi.urls.EVENTSUB, params);

            const res = await this.makeApiCall(url, {
                headers: this.getHeaders(),
            });

            const data = res['data'];
            for (const sub of data) {
                if (sub['id'] === subscriptionID) {
                    return sub['status'];
                }
            }

            paginationCursor = res['pagination']['cursor'];
            if (paginationCursor === '') paginationCursor = undefined;
        } while (paginationCursor !== undefined);

        return 'not_exists';
    }

    /**
     * Deletes a subscription.
     * @param subscriptionID the id of the subscription
     * @private
     */
    private async deleteSubscription(subscriptionID: string): Promise<void> {
        const url = TwitchApi.getUrlWithParams(TwitchApi.urls.EVENTSUB, { 'id': subscriptionID });
        await this.makeApiCall(url, {
            method: 'delete',
            headers: this.getHeaders(),
        });
    }

    /**
     * Subscribes to the event of the given type for the given broadcaster.
     * @param type a Twitch EventSub event type
     * @param broadcasterID the id of the broadcaster
     * @param callbackRelativeUrl the relative url that will handle notifications for this event
     * @private
     */
    private async subscribeToEvent(type: string, broadcasterID: string, callbackRelativeUrl: string): Promise<void> {
        let cachedSubscriptions: Record<string, string> = await this._cache.get(broadcasterID);
        if (cachedSubscriptions !== undefined) {
            if (cachedSubscriptions[type] !== undefined) {
                const subID = cachedSubscriptions[type];
                const newStatus = await this.getSubscriptionStatus(type, subID);
                if (newStatus === 'enabled') {
                    logger.debug(`Cached sub is valid for '${broadcasterID}'`);
                    return;
                } else if (newStatus === 'webhook_callback_verification_pending') {
                    logger.warn(`Cached sub is pending verification for '${broadcasterID}'`);
                    return;
                } else {
                    logger.warn(`Cached sub is invalid (${newStatus}) for '${broadcasterID}', attempting to delete`);
                    if (newStatus !== 'not_exists') await this.deleteSubscription(subID);
                    delete cachedSubscriptions[type];
                    await this._cache.set(broadcasterID, cachedSubscriptions);
                }
            }
        } else {
            cachedSubscriptions = {};
        }

        const payload = new EventSubPayload(type, broadcasterID, this._callbackBaseUrl + callbackRelativeUrl,
            this._callbackSecret);

        const res = await this.makeApiCall(TwitchApi.urls.EVENTSUB, {
            method: 'post',
            headers: this.getHeaders({ json: true }),
            body: JSON.stringify(payload),
        });
        cachedSubscriptions[type] = res['data'][0]['id'];
        await this._cache.set(broadcasterID, cachedSubscriptions);
        logger.debug(`Subscribed to '${type}' for '${broadcasterID}'`);
    }

    /**
     * Subscribes to receive notification for stream updates for the given user.
     * @param broadcasterUsername
     */
    async subscribeToStreamUpdates(broadcasterUsername: string): Promise<void> {
        const broadcasterID = await this.getUserID(broadcasterUsername);
        if (broadcasterID) {
            await this.subscribeToEvent('stream.online', broadcasterID, '/online');
            await this.subscribeToEvent('stream.offline', broadcasterID, '/offline');
            await this.subscribeToEvent('channel.update', broadcasterID, '/update');
        }
    }

    /**
     * Gets stream info for the given broadcaster's stream.
     * @param broadcasterID the id of the broadcaster
     */
    async getStreamInfo(broadcasterID: string) {
        const url = TwitchApi.getUrlWithParams(TwitchApi.urls.STREAMS, { 'user_id': broadcasterID });
        const res = await this.makeApiCall(url, { headers: this.getHeaders() });
        if (res) {
            const info = res['data'][0];
            if (!info) {
                logger.error(`Invalid broadcasterID '${broadcasterID}'`);
                return undefined;
            }
            return info;
        }
    }

    /**
     * Makes a call to the specified API endpoint and handles errors. If the call is successful returns the payload of the response.
     * @param url the url of the endpoint
     * @param options the options for the request
     * @private
     */
    private async makeApiCall(url, options): Promise<object> {
        let attemptLeft = 2;
        do {
            const res = await fetch(url, options);
            let payload = undefined;
            try {
                payload = await res.json() as Promise<object>;
            } catch (e) {
                if (!(e instanceof SyntaxError)) throw e;
            }
            if (res.ok) {
                return payload;
            } else if (res.status === 401) {
                logger.info('Twitch App Token has expired, requesting new one');
                await this.getAppToken(true);
            } else {
                logger.error(`Request to '${url}' failed with code ${res.status}\n${JSON.stringify(payload, null, 2)}`);
                return undefined;
            }
            attemptLeft--;
        } while (attemptLeft != 0);
        logger.error('Something went wrong generating a new Twitch API token');
        return undefined;
    }
}