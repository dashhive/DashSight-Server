"use strict";

let DashSightServer = module.exports;

let Shuffle = require("knuth-shuffle");

let Net = require("node:net");

let AsyncRouter = require("@root/async-router");
let WebSocket = require("ws");

DashSightServer.create = function ({ rpc, wss, authenticate }) {
  let dss = {};

  dss._rpc = rpc;

  dss.init = async function () {
    void (await rpc.init());
  };

  dss.api = {};
  dss.api.masternodelist = async function () {
    let evonodeEntries = [];
    {
      let resp = await dss._rpc.masternodelist();
      let evonodesMap = resp.result;
      let evonodeProTxIds = Object.keys(evonodesMap);
      for (let id of evonodeProTxIds) {
        let evonode = evonodesMap[id];
        if (evonode.status === "ENABLED") {
          let hostParts = evonode.address.split(":");
          // TODO
          let evodata = {
            id: evonode.id,
            hostname: hostParts[0],
            port: hostParts[1],
            type: evonode.type,
          };
          evonodeEntries.push([evonode.address, evodata]);
        }
      }
      if (!evonodeEntries.length) {
        throw new Error("Sanity Fail: no evonodes online");
      }
    }
    Shuffle.knuthShuffle(evonodeEntries);
    return evonodeEntries;
  };

  dss.routes = {};

  dss.routes.rpc = {};
  dss.routes.rpc.masternodelist = async function (req, res, next) {
    let resp = await dss._rpc.masternodelist();
    res.json(resp);
  };

  dss.routes.api = {};
  dss.routes.api.masternodelist = async function (req, res, next) {
    let evonodeEntries = await dss.api.masternodelist();
    let evonodesMap = Object.fromEntries(evonodeEntries);
    let evonodes = Object.values(evonodesMap);
    let response = {
      success: true,
      result: evonodes,
      // error: null,
    };
    res.json(response);
  };

  dss.sockets = {};
  dss.sockets.onconnection = async function (ws, request) {
    ws.on("error", console.error);

    // TODO session should establish which hostname and port
    if (authenticate) {
      // let session
      void (await authenticate(request));
    }

    if (!request.query) {
      let url = new URL(ws.url);
      let query = Object.fromEntries(url.searchParams.entries);
      Object.assign(request, { query });
    }
    let query = request.query;
    let address = `${query.hostname}:${query.port}`;

    let evonodeEntries = await dss.api.masternodelist();
    let evonodesMap = Object.fromEntries(evonodeEntries);
    if (!evonodesMap) {
      request.statusCode = 502;
      request.end(
        `{ "error": { "message": "'${query.hostname}:${query.port}' is not a valid evonode" } }`,
      );
      return;
    }

    console.log(`DEBUG ws query:`);
    console.log(query);
    let stream = WebSocket.createWebSocketStream(ws);
    let conn = Net.createConnection({
      host: query.hostname,
      port: query.port,
      keepAlive: true,
      keepAliveInitialDelay: 3,
      //localAddress: rpc.host,
    });
    stream.pipe(conn);
    conn.pipe(stream);

    stream.once("error", disconnect);
    stream.once("end", disconnect);
    stream.once("close", disconnect);
    function disconnect() {
      conn.end();
      conn.destroy();
    }
  };

  dss.router = new AsyncRouter.Router();
  dss.router.get("/rpc/masternodelist", dss.routes.rpc.masternodelist);
  dss.router.get("/api/masternodelist", dss.routes.api.masternodelist);

  dss.wss = wss;
  dss.wss.on("connection", dss.sockets.onconnection);

  return dss;
};
