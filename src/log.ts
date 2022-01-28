import { createLogger, format, transports } from 'winston';

export default createLogger({
    level: process.env.DEBUG ? 'debug' : 'info',
    format: format.printf(options => {
        if (options.moduleName) {
            return `[${options.moduleName}] ${options.level}: ${options.message}$`;
        } else {
            return `[Main] ${options.level}: ${options.message}$`;
        }
    }),
    transports: [
        new transports.Console(),
    ],
});