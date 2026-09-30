// 僅供冒煙測試（node -r 預先載入）：讓 server.js 改聽 127.0.0.1 的測試 port、不開瀏覽器、
// 不讀寫 rubicon-server.json，避免干擾本機設定或觸發防火牆詢問。
'use strict';
const net = require('net');
const fs = require('fs');
const cp = require('child_process');

const PORTS = { 80: +process.env.TEST_GAME_PORT, 8090: +process.env.TEST_CONTROL_PORT };
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (port, host, ...rest) {
  if (typeof port === 'number' && PORTS[port]) port = PORTS[port];
  if (typeof host === 'string') host = '127.0.0.1';
  return listen.call(this, port, host, ...rest);
};

const isCfg = (p) => String(p).endsWith('rubicon-server.json');
const readFileSync = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  if (isCfg(p)) throw Object.assign(new Error('測試模式不讀設定檔'), { code: 'ENOENT' });
  return readFileSync.call(this, p, ...rest);
};
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = function (p, ...rest) {
  if (isCfg(p)) return;
  return writeFileSync.call(this, p, ...rest);
};

cp.exec = (cmd, cb) => cb && cb(null, '', '');
