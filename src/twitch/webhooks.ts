import { logger } from '../index.js';
import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

// Notification request headers
const TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLowerCase();
const TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLowerCase();
const TWITCH_MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

// Prepend this string to the HMAC that's created from the message
const HMAC_PREFIX = 'sha256=';

export function startWebserver(port: number, secret: string, onReady: () => void) {
    const app = express();

    app.set('port', port);
    app.use(express.raw({
        type: 'application/json',
    }));

    app.post('/online', (req, res) => {
        console.log('POST /online: ', req.body);
        if (!verifyRequestHmac(secret, req, res)) return;
        if (!isNotification(req, res)) return;
    });

    app.post('/offline', (req, res) => {
        console.log('POST /offline: ', req.body);
        if (!verifyRequestHmac(secret, req, res)) return;
        if (!isNotification(req, res)) return;
    });

    app.post('/update', (req, res) => {
        console.log('POST /update: ', req.body);
        if (!verifyRequestHmac(secret, req, res)) return;
        if (!isNotification(req, res)) return;
    });

    app.listen(app.get('port'), onReady);
}

function verifyRequestHmac(secret, req, res): boolean {
    const message = getHmacMessage(req);
    const hmac = HMAC_PREFIX + getHmac(secret, message);

    if (verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
        return true;
    } else {
        logger.warn('Received request with invalid hmac');
        res.sendStatus(403);
        return false;
    }
}

function isNotification(req, res): boolean {
    const message = JSON.parse(req.body);
    switch (req.headers[TWITCH_MESSAGE_TYPE]) {
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
    }
}

// Build the message used to get the HMAC.
function getHmacMessage(request) {
    return (request.headers[TWITCH_MESSAGE_ID] +
        request.headers[TWITCH_MESSAGE_TIMESTAMP] +
        request.body);
}

// Get the HMAC.
function getHmac(secret, message) {
    return createHmac('sha256', secret)
        .update(message)
        .digest('hex');
}

// Verify whether your signature matches Twitch's signature.
function verifyMessage(hmac, verifySignature) {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(verifySignature));
}