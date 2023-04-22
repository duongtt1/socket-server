require('dotenv').config();
const cluster = require("cluster");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const numCPUs = require("os").cpus().length;
const { setupMaster, setupWorker } = require("@socket.io/sticky");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");
const Redis = require("ioredis");
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const compression = require('compression');
const helmet = require('helmet');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;

const redisClient = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT
});

const app = express();
const httpServer = http.createServer(app);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        sendCommand: function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return redisClient.call.apply(redisClient, args);
        },
    }),
});

app.use(compression());
app.use(helmet());
app.use(limiter);

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);

    setupMaster(httpServer, {
        loadBalancingMethod: "least-connection",
    });

    setupPrimary();

    cluster.setupMaster({
        serialization: "advanced",
    });

    httpServer.listen(3000);

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker) => {
        console.log(`Worker ${worker.processripid} died`);
        cluster.fork();
    });
} else {
    console.log(`Worker ${process.pid} started`);

    const io = new Server(httpServer);

    io.adapter(createAdapter(redisClient));

    setupWorker(io);

    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id} in worker ${process.pid}`);

        socket.on('message', (data) => {
            console.log(`Received message: ${data}`);
            io.emit('client2', data);
        });

        socket.on('testsendfromappteacher', (data) => { 
            console.log(`Received message: ${data}`);
            io.emit('sendtotools', data);
        });

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id} in worker ${process.pid}`);
        });
    });
}
