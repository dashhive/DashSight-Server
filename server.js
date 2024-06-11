"use strict";

let Dotenv = require("dotenv");
Dotenv.config({ path: ".env" });

let port = process.env.PORT || 8080;

let DashSightServer = require("./");
let DashRpc = require("dashrpc");

let Http = require("node:http");

let express = require("express");
let morgan = require("morgan");
let WebSocket = require("ws");

let app = express();
let logger = morgan("tiny");

let dss;
let wss;
{
  let rpcConfig = {
    protocol: "http", // https for remote, http for local / private networking
    user: process.env.DASHD_RPC_USER,
    pass: process.env.DASHD_RPC_PASS || process.env.DASHD_RPC_PASSWORD,
    host: process.env.DASHD_RPC_HOST || "127.0.0.1",
    port: process.env.DASHD_RPC_PORT || "19898", // mainnet=9998, testnet=19998, regtest=19898
    timeout: 10 * 1000, // bump default from 5s to 10s for up to 10k addresses
    onconnected: async function () {
      console.info(`[info] rpc client connected ${rpc.host}`);
    },
  };

  if (process.env.DASHD_RPC_TIMEOUT) {
    let rpcTimeoutSec = parseFloat(process.env.DASHD_RPC_TIMEOUT);
    rpcConfig.timeout = rpcTimeoutSec * 1000;
  }

  let rpc = new DashRpc(rpcConfig);
  wss = new WebSocket.WebSocketServer({ noServer: true });

  async function authenticate(request) {
    let url = new URL(request.url, "wss://ignore.me");
    let query = Object.fromEntries(url.searchParams.entries());
    Object.assign(request, { query });

    // TODO authenticate
    if (!query.access_token) {
      throw new Error("dummy authentication failed");
    }

    let session = { dummy: true, user: null };
    return session;
  }

  dss = DashSightServer.create({ rpc, wss, authenticate });
}

app.use("/", logger);
app.use("/", dss.router);
app.use("/", function (err, req, res, next) {
  let friendly = err.status >= 400 && err.status < 500;
  if (!friendly) {
    console.error("Error:", req.method, req.url, req.query);
    console.error(err.stack);
  }

  res.statusCode = err.status || 500;
  res.json({
    status: err.status || 500,
    code: err.code,
    message: err.message,
  });
});

let server = Http.createServer(app);

server.on("upgrade", function upgrade(request, socket, head) {
  // TODO handle /tcp, /tcp/, /tcp?
  let isTcp = request.url.startsWith("/tcp");
  if (!isTcp) {
    request.statusCode = 404;
    request.end(
      `{ "error": { "message": "'${request.url}' is not a valid websocket path" } }`,
    );
    return;
  }

  wss.handleUpgrade(request, socket, head, function (ws) {
    wss.emit("connection", ws, request);
  });
});

server.listen(port, function () {
  let address = server.address();
  console.info("listening on", address);
});

dss.init().catch(function (err) {
  console.error("initialization failed:");
  console.error(err.stack || err);
});
