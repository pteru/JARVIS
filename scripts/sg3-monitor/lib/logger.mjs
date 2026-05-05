const ts = () => new Date().toISOString();

export function makeLogger(component) {
  const prefix = (level) => `[${ts()}] [${level}] [${component}]`;
  return {
    info:  (msg, extra) => console.log(prefix('info'),  msg, extra ?? ''),
    warn:  (msg, extra) => console.warn(prefix('warn'), msg, extra ?? ''),
    error: (msg, extra) => console.error(prefix('error'), msg, extra ?? ''),
    debug: (msg, extra) => process.env.DEBUG && console.log(prefix('debug'), msg, extra ?? ''),
  };
}
