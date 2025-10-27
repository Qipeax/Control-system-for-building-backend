const express = require("express");
const cors = require("cors");
const axios = require("axios");
const CircuitBreaker = require("opossum");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const Joi = require("joi");

const app = express();
const PORT = process.env.PORT || 8000;
// Конфигурация
const config = {
  services: {
    users: {
      url: process.env.USERS_SERVICE_URL || "http://service_users:8000",
      timeout: parseInt(process.env.USERS_SERVICE_TIMEOUT) || 3000,
    },
    orders: {
      url: process.env.ORDERS_SERVICE_URL || "http://service_orders:8000",
      timeout: parseInt(process.env.ORDERS_SERVICE_TIMEOUT) || 3000,
    },
  },
  circuitBreaker: {
    timeout: parseInt(process.env.CIRCUIT_TIMEOUT) || 3000,
    errorThresholdPercentage:
      parseInt(process.env.CIRCUIT_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CIRCUIT_RESET_TIMEOUT) || 30000,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов за окно
  },
};
// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit(config.rateLimit));
