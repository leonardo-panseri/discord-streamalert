import express from 'express';
import bodyParser from 'body-parser';

export function startWebserver(port: number, onReady: () => void) {
    const app = express();

    app.set('port', port);
    app.use(bodyParser.json());

    app.post('/online', (req, res) => {
        console.log('POST /online: ', req.body);
        res.sendStatus(200);
    });

    app.post('/offline', (req, res) => {
        console.log('POST /offline: ', req.body);
        res.sendStatus(200);
    });

    app.post('/update', (req, res) => {
        console.log('POST /update: ', req.body);
        res.sendStatus(200);
    });

    app.listen(app.get('port'), onReady);
}

