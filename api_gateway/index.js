const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');

const app = express();
const PORT = process.env.PORT || 8000;

// ========== ВСЕ ПРЕДЫДУЩИЕ ШАГИ + НОВОЕ ==========
const CONFIG = {
    SERVICES: {
        USERS: {
            URL: process.env.USERS_SERVICE_URL || 'http://service_users:8000',
            TIMEOUT: 3000
        },
        ORDERS: {
            URL: process.env.ORDERS_SERVICE_URL || 'http://service_orders:8000',
            TIMEOUT: 3000
        }
    },
    CIRCUIT_BREAKER: {
        TIMEOUT: 3000,
        ERROR_THRESHOLD_PERCENTAGE: 50,
        RESET_TIMEOUT: 3000
    }
};

// ========== ШАГ 3: Простое логирование ==========
const logger = {
    info: (message) => console.log(`[INFO] ${new Date().toISOString()} - ${message}`),
    error: (message, error) => console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error),
    warn: (message) => console.warn(`[WARN] ${new Date().toISOString()} - ${message}`)
};

// Middleware
app.use(cors());
app.use(express.json());

// ========== ШАГ 3: Middleware для логирования запросов ==========
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

// Классы из Шага 2 (оставляем без изменений)
class BaseService {
    constructor(serviceName, baseUrl, circuitBreaker) {
        this.serviceName = serviceName;
        this.baseUrl = baseUrl;
        this.circuit = circuitBreaker;
    }

    async request(path, method = 'GET', data = null) {
        const url = `${this.baseUrl}${path}`;
        const options = { method };
        
        if (data && (method === 'POST' || method === 'PUT')) {
            options.data = data;
        }
        
        return this.circuit.fire(url, options);
    }

    getFallbackMessage() {
        return `${this.serviceName} service temporarily unavailable`;
    }
}

class UserService extends BaseService {
    constructor(circuitBreaker) {
        super('users', CONFIG.SERVICES.USERS.URL, circuitBreaker);
    }

    async getUser(userId) {
        return this.request(`/users/${userId}`);
    }

    async createUser(userData) {
        return this.request('/users', 'POST', userData);
    }

    async getAllUsers() {
        return this.request('/users');
    }

    async updateUser(userId, userData) {
        return this.request(`/users/${userId}`, 'PUT', userData);
    }

    async deleteUser(userId) {
        return this.request(`/users/${userId}`, 'DELETE');
    }
}

class OrderService extends BaseService {
    constructor(circuitBreaker) {
        super('orders', CONFIG.SERVICES.ORDERS.URL, circuitBreaker);
    }

    async getOrder(orderId) {
        return this.request(`/orders/${orderId}`);
    }

    async createOrder(orderData) {
        return this.request('/orders', 'POST', orderData);
    }

    async getAllOrders() {
        return this.request('/orders');
    }

    async updateOrder(orderId, orderData) {
        return this.request(`/orders/${orderId}`, 'PUT', orderData);
    }

    async deleteOrder(orderId) {
        return this.request(`/orders/${orderId}`, 'DELETE');
    }

    async getStatus() {
        return this.request('/orders/status');
    }

    async getHealth() {
        return this.request('/orders/health');
    }

    async getOrdersByUserId(userId) {
        const allOrders = await this.getAllOrders();
        if (Array.isArray(allOrders)) {
            return allOrders.filter(order => order.userId == userId);
        }
        return [];
    }
}

// ========== ШАГ 3: Улучшенная фабрика Circuit Breaker ==========
function createCircuitBreaker(serviceName) {
    const options = {
        timeout: CONFIG.CIRCUIT_BREAKER.TIMEOUT,
        errorThresholdPercentage: CONFIG.CIRCUIT_BREAKER.ERROR_THRESHOLD_PERCENTAGE,
        resetTimeout: CONFIG.CIRCUIT_BREAKER.RESET_TIMEOUT,
    };

    const circuit = new CircuitBreaker(async (url, options = {}) => {
        try {
            const response = await axios({
                url, ...options,
                validateStatus: status => (status >= 200 && status < 300) || status === 404
            });
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return error.response.data;
            }
            throw error;
        }
    }, options);

    // Логирование событий Circuit Breaker
    circuit.on('open', () => logger.warn(`Circuit breaker for ${serviceName} opened`));
    circuit.on('close', () => logger.info(`Circuit breaker for ${serviceName} closed`));
    circuit.on('halfOpen', () => logger.info(`Circuit breaker for ${serviceName} half-open`));
    circuit.on('failure', (error) => logger.error(`Circuit breaker for ${serviceName} failure`, error));

    return circuit;
}

// Инициализация сервисов
const usersCircuit = createCircuitBreaker('users');
const ordersCircuit = createCircuitBreaker('orders');

const userService = new UserService(usersCircuit);
const orderService = new OrderService(ordersCircuit);

usersCircuit.fallback(() => ({ error: userService.getFallbackMessage() }));
ordersCircuit.fallback(() => ({ error: orderService.getFallbackMessage() }));

// ========== ШАГ 3: Middleware для валидации ID ==========
function validateId(req, res, next) {
    const userId = req.params.userId;
    const orderId = req.params.orderId;
    const id = userId || orderId;
    
    if (!id) {
        return next(); // Если нет ID, пропускаем
    }
    
    // Простая валидация: только буквы, цифры, дефисы и подчеркивания
    if (!/^[a-zA-Z0-9-_]+$/.test(id)) {
        return res.status(400).json({ 
            error: 'Invalid ID format',
            message: 'ID can only contain letters, numbers, hyphens, and underscores'
        });
    }
    
    next();
}

// ========== ШАГ 3: Обертка для обработки ошибок ==========
function asyncHandler(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (error) {
            logger.error('Unhandled error in route handler', error);
            next(error);
        }
    };
}

// ========== ШАГ 3: Глобальный обработчик ошибок ==========
app.use((error, req, res, next) => {
    logger.error('Global error handler caught:', error);
    
    // Если это ошибка Circuit Breaker
    if (error.message && error.message.includes('circuit')) {
        return res.status(503).json({
            error: 'Service temporarily unavailable',
            timestamp: new Date().toISOString()
        });
    }
    
    // Для всех остальных ошибок
    res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// ========== ОБНОВЛЕННЫЕ МАРШРУТЫ С VALIDATE_ID И ASYNC_HANDLER ==========

// User routes
app.get('/users/:userId', validateId, asyncHandler(async (req, res) => {
    const user = await userService.getUser(req.params.userId);
    if (user.error === 'User not found') {
        res.status(404).json(user);
    } else {
        res.json(user);
    }
}));

app.post('/users', asyncHandler(async (req, res) => {
    const user = await userService.createUser(req.body);
    res.status(201).json(user);
}));

app.get('/users', asyncHandler(async (req, res) => {
    const users = await userService.getAllUsers();
    res.json(users);
}));

app.delete('/users/:userId', validateId, asyncHandler(async (req, res) => {
    const result = await userService.deleteUser(req.params.userId);
    res.json(result);
}));

app.put('/users/:userId', validateId, asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.params.userId, req.body);
    res.json(user);
}));

// Order routes
app.get('/orders/:orderId', validateId, asyncHandler(async (req, res) => {
    const order = await orderService.getOrder(req.params.orderId);
    if (order.error === 'Order not found') {
        res.status(404).json(order);
    } else {
        res.json(order);
    }
}));

app.post('/orders', asyncHandler(async (req, res) => {
    const order = await orderService.createOrder(req.body);
    res.status(201).json(order);
}));

app.get('/orders', asyncHandler(async (req, res) => {
    const orders = await orderService.getAllOrders();
    res.json(orders);
}));

app.delete('/orders/:orderId', validateId, asyncHandler(async (req, res) => {
    const result = await orderService.deleteOrder(req.params.orderId);
    res.json(result);
}));

app.put('/orders/:orderId', validateId, asyncHandler(async (req, res) => {
    const order = await orderService.updateOrder(req.params.orderId, req.body);
    res.json(order);
}));

app.get('/orders/status', asyncHandler(async (req, res) => {
    const status = await orderService.getStatus();
    res.json(status);
}));

app.get('/orders/health', asyncHandler(async (req, res) => {
    const health = await orderService.getHealth();
    res.json(health);
}));

// Gateway Aggregation
app.get('/users/:userId/details', validateId, asyncHandler(async (req, res) => {
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
}));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'API Gateway is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        circuits: {
            users: usersCircuit.status,
            orders: ordersCircuit.status
        }
    });
});

app.get('/status', (req, res) => {
    res.json({ status: 'API Gateway is running' });
});

// ========== ШАГ 3: Обработка 404 ==========
app.use('*', (req, res) => {
    logger.warn(`Route not found: ${req.originalUrl}`);
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl
    });
});

// Start server
app.listen(PORT, () => {
    logger.info(`API Gateway running on port ${PORT}`);
});