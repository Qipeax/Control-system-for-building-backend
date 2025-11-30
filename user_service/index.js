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
    super("orders", baseUrl, circuitBreaker);
  }

  async getOrder(orderId) {
    return this.request(`/orders/${orderId}`);
  }

  async createOrder(orderData) {
    return this.request("/orders", {
      method: "POST",
      data: orderData,
    });
  }

  async getOrders() {
    return this.request("/orders");
  }

  async getOrdersByUserId(userId) {
    const allOrders = await this.getOrders();
    return allOrders.filter((order) => order.userId == userId);
  }

  async updateOrder(orderId, orderData) {
    return this.request(`/orders/${orderId}`, {
      method: "PUT",
      data: orderData,
    });
  }

  async deleteOrder(orderId) {
    return this.request(`/orders/${orderId}`, {
      method: "DELETE",
    });
  }

  async getStatus() {
    return this.request("/orders/status");
  }

  async getHealth() {
    return this.request("/orders/health");
  }
}

// Валидация
const userSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(0).max(150).optional(),
});

const orderSchema = Joi.object({
  userId: Joi.string().required(),
  product: Joi.string().min(1).max(255).required(),
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().min(0).precision(2).required(),
});

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: "Validation failed",
      details: error.details.map((detail) => detail.message),
    });
  }
  next();
};

const validateId = (req, res, next) => {
  const id = req.params.userId || req.params.orderId;
  if (!id || !/^[a-zA-Z0-9-_]+$/.test(id)) {
    return res.status(400).json({
      error: "Invalid ID format",
    });
  }
  next();
};
// Обработка ошибок
const errorHandler = (error, req, res, next) => {
  logger.error("Unhandled error:", {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
  });

  if (error.status) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.details && { details: error.details }),
    });
  }

  if (error.message && error.message.includes("circuit")) {
    return res.status(503).json({
      error: "Service temporarily unavailable",
      timestamp: new Date().toISOString(),
    });
  }

  res.status(500).json({
    error: "Internal server error",
    timestamp: new Date().toISOString(),
  });
};

// Инициализация сервисов
const circuitFactory = new CircuitBreakerFactory(config.circuitBreaker);

const userService = new UserService(
    circuitFactory.create('users'),
    config.services.users.url
);

const orderService = new OrderService(
    circuitFactory.create('orders'),
    config.services.orders.url
);

// Маршруты для пользователей
app.get('/users/:userId', validateId, async (req, res, next) => {
    try {
        const user = await userService.getUser(req.params.userId);
        if (user.error === 'User not found') {
            res.status(404).json(user);
        } else {
            res.json(user);
        }
    } catch (error) {
        next(error);
    }
});

app.post('/users', validate(userSchema), async (req, res, next) => {
    try {
        const user = await userService.createUser(req.body);
        res.status(201).json(user);
    } catch (error) {
        next(error);
    }
});

app.get('/users', async (req, res, next) => {
    try {
        const users = await userService.getUsers();
        res.json(users);
    } catch (error) {
        next(error);
    }
});

app.put('/users/:userId', validateId, validate(userSchema), async (req, res, next) => {
    try {
        const user = await userService.updateUser(req.params.userId, req.body);
        res.json(user);
    } catch (error) {
        next(error);
    }
});

app.delete('/users/:userId', validateId, async (req, res, next) => {
    try {
        const result = await userService.deleteUser(req.params.userId);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Маршруты для заказов
app.get('/orders/:orderId', validateId, async (req, res, next) => {
    try {
        const order = await orderService.getOrder(req.params.orderId);
        if (order.error === 'Order not found') {
            res.status(404).json(order);
        } else {
            res.json(order);
        }
    } catch (error) {
        next(error);
    }
});

app.post('/orders', validate(orderSchema), async (req, res, next) => {
    try {
        const order = await orderService.createOrder(req.body);
        res.status(201).json(order);
    } catch (error) {
        next(error);
    }
});

app.get('/orders', async (req, res, next) => {
    try {
        const orders = await orderService.getOrders();
        res.json(orders);
    } catch (error) {
        next(error);
    }
});

app.delete('/orders/:orderId', validateId, async (req, res, next) => {
    try {
        const result = await orderService.deleteOrder(req.params.orderId);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.put('/orders/:orderId', validateId, validate(orderSchema), async (req, res, next) => {
    try {
        const order = await orderService.updateOrder(req.params.orderId, req.body);
        res.json(order);
    } catch (error) {
        next(error);
    }
});

app.get('/orders/status', async (req, res, next) => {
    try {
        const status = await orderService.getStatus();
        res.json(status);
    } catch (error) {
        next(error);
    }
});

app.get('/orders/health', async (req, res, next) => {
    try {
        const health = await orderService.getHealth();
        res.json(health);
    } catch (error) {
        next(error);
    }
});

// Агрегированный эндпоинт
app.get('/users/:userId/details', validateId, async (req, res, next) => {
    try {
        const userId = req.params.userId;

        const [user, userOrders] = await Promise.all([
            userService.getUser(userId),
            orderService.getOrdersByUserId(userId)
        ]);

        if (user.error === 'User not found') {
            return res.status(404).json(user);
        }

        res.json({
            user,
            orders: userOrders,
            summary: {
                totalOrders: userOrders.length,
                totalSpent: userOrders.reduce((sum, order) => sum + (order.price || 0), 0)
            }
        });
    } catch (error) {
        next(error);
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'API Gateway is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        circuits: {
            users: userService.circuit.status,
            orders: orderService.circuit.status
        }
    });
});

app.get('/status', (req, res) => {
    res.json({ status: 'API Gateway is running' });
});


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
