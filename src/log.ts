import { createLogger, format, transports } from 'winston';

const logger = createLogger({
    level: process.env.DEBUG ? 'debug' : 'info',
    format: format.printf(options => {
        if (options.moduleName) {
            return `[${options.moduleName}] ${options.level}: ${options.message}`;
        } else {
            return `[Main] ${options.level}: ${options.message}`;
        }
    }),
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