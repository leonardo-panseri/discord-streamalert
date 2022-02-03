import { createLogger, format, transports } from 'winston';

const logger = createLogger({
    level: process.env.DEBUG ? 'debug' : 'info',
    format: format.combine(
        format.timestamp({ format: 'MM-DD hh:mm:ss' }),
        format.printf(options => {
            if (options.moduleName) {
                return `${options.timestamp} [${options.moduleName}] ${options.level}: ${options.message}`;
            } else {
                return `${options.timestamp} [Main] ${options.level}: ${options.message}`;
            }
        })
    ),
    transports: [
        new transports.Console(),
    ],
});

function getLogger(moduleName?: string) {
    if (moduleName) {
        return logger.child({ moduleName: moduleName });
    } else {
        return logger;
    }
}

export default getLogger;