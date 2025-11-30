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
    windowMs: 15 * 60 * 1000,
    max: 100,
  },
};
// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit(config.rateLimit));

// Логирование
const logger = {
  info: (message, meta = {}) =>
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, meta),
  warn: (message, meta = {}) =>
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, meta),
  error: (message, meta = {}) =>
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, meta),
};

// Фабрика Circuit Breaker'ов
class CircuitBreakerFactory {
  constructor(options) {
    this.defaultOptions = options;
  }

  create(serviceName) {
    const circuit = new CircuitBreaker(this.createRequestFunction(), {
      ...this.defaultOptions,
      name: serviceName,
    });

    circuit.fallback(() => this.createFallbackResponse(serviceName));
    this.setupEventListeners(circuit, serviceName);

    return circuit;
  }

  createRequestFunction() {
    return async (url, options = {}) => {
      try {
        const response = await axios({
          url,
          ...options,
          validateStatus: (status) =>
            (status >= 200 && status < 300) || status === 404,
          timeout: config.circuitBreaker.timeout,
        });
        return response.data;
      } catch (error) {
        if (error.response && error.response.status === 404) {
          return error.response.data;
        }
        throw error;
      }
    };
  }
}

// Базовый сервис
class BaseService {
  constructor(serviceName, baseUrl, circuitBreaker) {
    this.serviceName = serviceName;
    this.baseUrl = baseUrl;
    this.circuit = circuitBreaker;
  }

  async request(endpoint, options = {}) {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      return await this.circuit.fire(url, options);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  handleError(error) {
    if (error.response) {
      return {
        status: error.response.status,
        message: error.response.data?.error || "Service error",
        details: error.response.data,
      };
    }

    return {
      status: 500,
      message: "Internal server error",
      details: error.message,
    };
  }
}

// Сервис пользователей
class UserService extends BaseService {
  constructor(circuitBreaker, baseUrl) {
    super("users", baseUrl, circuitBreaker);
  }

  async getUser(userId) {
    return this.request(`/users/${userId}`);
  }

  async createUser(userData) {
    return this.request("/users", {
      method: "POST",
      data: userData,
    });
  }

  async getUsers() {
    return this.request("/users");
  }

  async updateUser(userId, userData) {
    return this.request(`/users/${userId}`, {
      method: "PUT",
      data: userData,
    });
  }

  async deleteUser(userId) {
    return this.request(`/users/${userId}`, {
      method: "DELETE",
    });
  }
}

// Сервис заказов
class OrderService extends BaseService {
    constructor(circuitBreaker, baseUrl) {
        super('orders', baseUrl, circuitBreaker);
    }

    async getOrder(orderId) {
        return this.request(`/orders/${orderId}`);
    }

    async createOrder(orderData) {
        return this.request('/orders', {
            method: 'POST',
            data: orderData
        });
    }

    async getOrders() {
        return this.request('/orders');
    }

    async getOrdersByUserId(userId) {
        const allOrders = await this.getOrders();
        return allOrders.filter(order => order.userId == userId);
    }

    async updateOrder(orderId, orderData) {
        return this.request(`/orders/${orderId}`, {
            method: 'PUT',
            data: orderData
        });
    }

    async deleteOrder(orderId) {
        return this.request(`/orders/${orderId}`, {
            method: 'DELETE'
        });
    }

    async getStatus() {
        return this.request('/orders/status');
    }

    async getHealth() {
        return this.request('/orders/health');
    }
}


// Глобальная обработка ошибок
app.use(errorHandler);
// Обработка страницы 404

app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
});
