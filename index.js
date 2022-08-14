/**
 * @description: 服务端代码
 */
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { parse } = require('url');

// 缓存需要推送的信息
const datas = [];
// 储存各种方案触发推送时的回调方法
const callbacks = {};

// 开启服务
const server = http.createServer().listen(3000);
server.on('request', (req, res) => {
  const { pathname, query } = parse(req.url, true);
  if (pathname === '/') { // 加载html页面
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    return res.end(fs.readFileSync('static/index.html'));
  } else if (pathname.startsWith('/static/')) { // 加载静态资源
    res.statusCode = 200;
    return res.end(fs.readFileSync(pathname.substring(1)));
  } else if (pathname === '/api/push') { // 如果是前端触发推送接口
    if (query.info) {
      // 缓存推送信息
      datas.push(query.info);
      const d = JSON.stringify([query.info]);
      // 触发所有推送回调
      Object.keys(callbacks).forEach(k => callbacks[k](d));
    }
  } else if (pathname === '/api/polling') { // 短轮询
    const id = parseInt(query.id || '0', 10) || 0;
    res.writeHead(200, { 'Content-Type': 'application/json;' });
    return res.end(JSON.stringify(datas.slice(id)));
  } else if (pathname === '/api/long-polling') { // 长轮询
    const id = parseInt(query.id || '0', 10) || 0;
    const cbk = 'long-polling';
    delete callbacks[cbk];
    const data = datas.slice(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // 发起请求时，正好有新消息就返回
    if (data.length) {
      return res.end(JSON.stringify(data));
    }
    req.on('close', () => {
      delete callbacks[cbk];
    });
    // 注册新消息回调
    callbacks[cbk] = (d) => {
      res.end(d);
    };
    return;
  } else if (pathname === '/api/sse') { // SSE
    const cbk = 'sse';
    delete callbacks[cbk];
    // 核心设置
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(datas)}\n\n`);
    // 注册新消息回调
    callbacks[cbk] = (d) => {
      res.write(`data: ${d}\n\n`);
    };
    req.on('close', () => {
      delete callbacks[cbk];
    });
    return;
  } else if (pathname === '/api/iframe') { // iframe
    const cbk = 'iframe';
    delete callbacks[cbk];
    // 返回缓存信息
    res.write(`<script>window.parent.change(${JSON.stringify(datas)});</script>`);
    callbacks[cbk] = (d) => {
      res.write(`<script>window.parent.change(${d});</script>`);
    };
    req.on('close', () => {
      delete callbacks[cbk];
    });
    return;
  }
  console.log(datas, callbacks,  'pathname-----');
  res.write('hello world');
  res.end();
});

server.on('upgrade', (req, socket) => { // webSocket
  const cbk = 'ws';
  delete callbacks[cbk];
  const acceptKey = req.headers['sec-websocket-key'];
  const hash = generateAcceptValue(acceptKey);
  const responseHeaders = ['HTTP/1.1 101 Web Socket Protocol Handshake', 'Upgrade: WebSocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${hash}`];
  // 告知前端这是WebSocket协议
  socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
  // 发送数据
  socket.write(constructReply(datas));
  callbacks[cbk] = (d) => {
    socket.write(constructReply(d));
  }
  socket.on('close', () => {
    delete callbacks[cbk];
  });
});

function generateAcceptValue (acceptKey) {
  return crypto
    .createHash('sha1')
    .update(acceptKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
    .digest('base64');
}

function constructReply (data) {
  // Convert the data to JSON and copy it into a buffer
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const jsonByteLength = Buffer.byteLength(json);
  // Note: we're not supporting > 65535 byte payloads at this stage 
  const lengthByteCount = jsonByteLength < 126 ? 0 : 2;
  const payloadLength = lengthByteCount === 0 ? jsonByteLength : 126;
  const buffer = Buffer.alloc(2 + lengthByteCount + jsonByteLength);
  // Write out the first byte, using opcode `1` to indicate that the message 
  // payload contains text data 
  buffer.writeUInt8(0b10000001, 0);
  buffer.writeUInt8(payloadLength, 1);
  // Write the length of the JSON payload to the second byte 
  let payloadOffset = 2;
  if (lengthByteCount > 0) {
    buffer.writeUInt16BE(jsonByteLength, 2); payloadOffset += lengthByteCount;
  }
  // Write the JSON data to the data buffer 
  buffer.write(json, payloadOffset);
  return buffer;
}