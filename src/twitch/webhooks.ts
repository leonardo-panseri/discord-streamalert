import { getLogger } from '../index.js';
import { StreamManager } from '../stream_manager.js';
import { JsonPayload } from '../helper.js';
import express, { Express, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

const logger = getLogger('Webhooks');

/** Represents a Twitch EventSub notification */
interface Notification {
    'payload': JsonPayload,
    'broadcasterId': string,
    'broadcasterLogin': string
}

/** Manages the web app that receives and handles Twitch EventSub updates through webhooks */
export class Webhooks {
    // Notification request headers
    private static readonly TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLowerCase();
    private static readonly TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLowerCase();
    private static readonly TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLowerCase();
    private static readonly TWITCH_MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

    // Prepend this string to the HMAC that's created from the message
    private static readonly HMAC_PREFIX = 'sha256=';

    private readonly _streamManager: StreamManager;
    /** Internal port to run the webserver on */
    private readonly _port: number;
    /** Secret to verify that messages are sent from Twitch */
    private readonly _secret: string;
    /** Function to call when the webserver has finished loading */
    private readonly _onReady: () => void;

    private _app?: Express;

    constructor(streamManager: StreamManager, port: number, secret: string, onReady: () => void) {
        this._streamManager = streamManager;
        this._port = port;
        this._secret = secret;
        this._onReady = onReady;
    }

    /** Instantiate and set up a new Express app and starts it on the given port */
    startWebserver(): void {
        this._app = express();

        this._app.use(express.raw({
            type: 'application/json',
        }));

        this._app.post('/online', (req, res) => {
            this.handleRequest(req, res, Webhooks.streamOnlineHandler);
        });

        this._app.post('/offline', (req, res) => {
            this.handleRequest(req, res, Webhooks.streamOfflineHandler);
        });

        this._app.post('/update', (req, res) => {
            this.handleRequest(req, res, Webhooks.channelUpdateHandler);
        });

        this._app.listen(this._port, this._onReady);
    }

    /**
     * Builds the message used to get the HMAC.
     * @param req the request to build the HMAC for
     * @private
     */
    private static getHmacMessage(req: Request): string {
        return (req.headers[Webhooks.TWITCH_MESSAGE_ID] as string +
            req.headers[Webhooks.TWITCH_MESSAGE_TIMESTAMP] +
            req.body);
    }

    /**
     * Gets the HMAC for the given message.
     * @param message the message
     * @private
     */
    private getHmac(message: string): string {
        return createHmac('sha256', this._secret)
            .update(message)
            .digest('hex');
    }

    /**
     * Verifies that the HMAC of the request is valid, sends status 403 if it is not.
     * @param req the received request
     * @param res the response object to send status codes to
     * @private
     */
    private verifyRequestHmac(req: Request, res: Response): boolean {
        const message = Webhooks.getHmacMessage(req);
        const hmac = Webhooks.HMAC_PREFIX + this.getHmac(message);
        const receivedHmac: string = req.headers[Webhooks.TWITCH_MESSAGE_SIGNATURE] as string;
        if (!hmac || !receivedHmac) {
            logger.warn('HMAC not present in request');
            res.sendStatus(403);
            return false;
        }

        const valid = timingSafeEqual(Buffer.from(hmac), Buffer.from(receivedHmac));
        if (valid) {
            return true;
        } else {
            logger.warn('Received request with invalid hmac');
            res.sendStatus(403);
            return false;
        }
    }

    /**
     * Verifies the type of request and send status codes accordingly, if type is 'notification' returns true
     * @param req the received request
     * @param res the response object to send status codes to
     * @private
     */
    private static isNotification(req: Request, res: Response): boolean {
        const message = JSON.parse(req.body);
        const reqType: string = req.headers[Webhooks.TWITCH_MESSAGE_TYPE] as string;
        switch (reqType) {
        case 'notification':
            res.sendStatus(200);
            return true;
        case 'webhook_callback_verification':
            res.status(200).send(message.challenge);
            break;
        case 'revocation':
            res.sendStatus(204);

            logger.warn(`${message.subscription.type} notifications revoked!`);
            logger.warn(`reason: ${message.subscription.status}`);
            logger.warn(`condition: ${JSON.stringify(message.subscription.condition, null, 4)}`);
            break;
        default:
            res.sendStatus(200);
            logger.warn(`Received request of unknown type '${reqType}'`);
            break;
        }
        return false;
    }

    /**
     * Handles an incoming request.
     * @param req the request object
     * @param res the response object to send status codes to
     * @param handler the function that will handle this request's notification
     * @private
     */
    private handleRequest(req: Request, res: Response, handler: (streamManager: StreamManager, notification: Notification) => void): void {
        if (!this.verifyRequestHmac(req, res)) return;
        if (!Webhooks.isNotification(req, res)) return;
        const payload = JSON.parse(req.body);
        const broadcasterId = payload['event']['broadcaster_user_id'];
        const broadcasterLogin = payload['event']['broadcaster_user_login'];
        handler(this._streamManager, { 'payload': payload, 'broadcasterId': broadcasterId, 'broadcasterLogin': broadcasterLogin });
    }

    /**
     * Handles the stream.online notification.
     * @param streamManager the instance of the manager that will handle this notification
     * @param notification the notification that has been received
     * @private
     */
    private static streamOnlineHandler(streamManager: StreamManager, notification: Notification): void {
        const broadcasterName = (notification.payload['event'] as JsonPayload)['broadcaster_user_name'] as string;
        streamManager.onStreamOnline(notification.broadcasterId, notification.broadcasterLogin, broadcasterName)
            .then(() => logger.debug('Finished handling of stream.online notification'));
    }

    /**
     * Handles the stream.offline notification.
     * @param streamManager the instance of the manager that will handle this notification
     * @param notification the notification that has been received
     * @private
     */
    private static streamOfflineHandler(streamManager: StreamManager, notification: Notification): void {
        streamManager.onStreamOffline(notification.broadcasterId, notification.broadcasterLogin)
            .then(() => logger.debug('Finished handling of stream.offline notification'));
    }

    /**
     * Handles the channel.update notification.
     * @param streamManager the instance of the manager that will handle this notification
     * @param notification the notification that has been received
     * @private
     */
    private static channelUpdateHandler(streamManager: StreamManager, notification: Notification): void {
        const category = (notification.payload['event'] as JsonPayload)['category_name'] as string;
        streamManager.onChannelUpdate(notification.broadcasterId, notification.broadcasterLogin, category)
            .then(() => logger.debug('Finished handling of channel.update notification'));
    }
}