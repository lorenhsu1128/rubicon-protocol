// 僅供冒煙測試（node -r 預先載入）：讓 server.js 改聽 127.0.0.1 的測試 port、不開瀏覽器、
// 不讀寫 rubicon-server.json，避免干擾本機設定或觸發防火牆詢問。
'use strict';
const net = require('net');
const fs = require('fs');
const cp = require('child_process');

// port 設成 0 時由系統挑空的 port，實際的 port 印成「[test-port] 原本 實際」給冒煙測試讀
// （分段平行時多個伺服器同時啟動，不能先找空 port 再交給伺服器，中間可能被別的程序搶走）
const PORTS = { 80: +process.env.TEST_GAME_PORT, 8090: +process.env.TEST_CONTROL_PORT };
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (port, host, ...rest) {
  if (typeof port === 'number' && port in PORTS && Number.isFinite(PORTS[port])) {
    const orig = port;
    port = PORTS[port];
    this.once('listening', () => console.log(`[test-port] ${orig} ${this.address().port}`));
  }
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
