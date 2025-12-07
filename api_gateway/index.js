const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');

const app = express();
const PORT = process.env.PORT || 8000;

const CONFIG = {
    SERVICES: {
        USERS: {
            URL: process.env.USERS_SERVICE_URL || 'http://service_users:8000',
            TIMEOUT: parseInt(process.env.USERS_SERVICE_TIMEOUT) || 3000
        },
        ORDERS: {
            URL: process.env.ORDERS_SERVICE_URL || 'http://service_orders:8000',
            TIMEOUT: parseInt(process.env.ORDERS_SERVICE_TIMEOUT) || 3000
        }
    },
    CIRCUIT_BREAKER: {
        TIMEOUT: parseInt(process.env.CIRCUIT_TIMEOUT) || 3000,
        ERROR_THRESHOLD_PERCENTAGE: parseInt(process.env.CIRCUIT_ERROR_THRESHOLD) || 50,
        RESET_TIMEOUT: parseInt(process.env.CIRCUIT_RESET_TIMEOUT) || 30000 // Исправлено: 30 секунд
    },
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 10000
};

// ========== ЛОГИРОВАНИЕ ==========
const logger = {
    info: (message, meta = {}) => console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        message,
        ...meta
    })),
    
    error: (message, error = null, meta = {}) => console.error(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        message,
        error: error ? error.message : null,
        stack: error ? error.stack : null,
        ...meta
    })),
    
    warn: (message, meta = {}) => console.warn(JSON.stringify({
        level: 'WARN',
        timestamp: new Date().toISOString(),
        message,
        ...meta
    }))
};

// Middleware
app.use(cors());
app.use(express.json());

// ========== MIDDLEWARE ДЛЯ ЛОГИРОВАНИЯ ЗАПРОСОВ ==========
app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Логируем начало запроса
    logger.info('Request started', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    
    // Перехватываем отправку ответа для логирования
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - startTime;
        
        logger.info('Request completed', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            contentLength: res.get('Content-Length')
        });
        
        return originalSend.call(this, data);
    };
    
    next();
});

// ========== КЛАССЫ СЕРВИСОВ ==========
class BaseService {
    constructor(serviceName, baseUrl, circuitBreaker) {
        this.serviceName = serviceName;
        this.baseUrl = baseUrl;
        this.circuit = circuitBreaker;
    }

    async request(path, method = 'GET', data = null) {
        const url = `${this.baseUrl}${path}`;
        const options = { 
            method,
            timeout: CONFIG.REQUEST_TIMEOUT
        };
        
        if (data && (method === 'POST' || method === 'PUT')) {
            options.data = data;
        }
        
        logger.info('Service request', {
            service: this.serviceName,
            url,
            method
        });
        
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
        try {
            const allOrders = await this.getAllOrders();
            if (Array.isArray(allOrders)) {
                return allOrders.filter(order => order.userId == userId);
            }
            return [];
        } catch (error) {
            logger.error('Failed to get orders by user ID', error, { userId });
            return [];
        }
    }
}

// ========== ФАБРИКА CIRCUIT BREAKER ==========
function createCircuitBreaker(serviceName) {
    const options = {
        timeout: CONFIG.CIRCUIT_BREAKER.TIMEOUT,
        errorThresholdPercentage: CONFIG.CIRCUIT_BREAKER.ERROR_THRESHOLD_PERCENTAGE,
        resetTimeout: CONFIG.CIRCUIT_BREAKER.RESET_TIMEOUT,
        name: serviceName
    };

    const circuit = new CircuitBreaker(async (url, requestOptions = {}) => {
        try {
            const response = await axios({
                url,
                ...requestOptions,
                validateStatus: status => (status >= 200 && status < 300) || status === 404,
                timeout: CONFIG.REQUEST_TIMEOUT
            });
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return error.response.data;
            }
            throw error;
        }
    }, options);

    // События Circuit Breaker
    circuit.on('open', () => logger.warn(`Circuit breaker opened`, { service: serviceName }));
    circuit.on('close', () => logger.info(`Circuit breaker closed`, { service: serviceName }));
    circuit.on('halfOpen', () => logger.info(`Circuit breaker half-open`, { service: serviceName }));
    circuit.on('failure', (error) => logger.error(`Circuit breaker failure`, error, { service: serviceName }));
    circuit.on('success', () => logger.info(`Circuit breaker request succeeded`, { service: serviceName }));

    return circuit;
}

// ========== ИНИЦИАЛИЗАЦИЯ СЕРВИСОВ ==========
const usersCircuit = createCircuitBreaker('users');
const ordersCircuit = createCircuitBreaker('orders');

const userService = new UserService(usersCircuit);
const orderService = new OrderService(ordersCircuit);

usersCircuit.fallback(() => ({ 
    error: userService.getFallbackMessage(),
    timestamp: new Date().toISOString()
}));

ordersCircuit.fallback(() => ({ 
    error: orderService.getFallbackMessage(),
    timestamp: new Date().toISOString()
}));

// ========== MIDDLEWARE ==========
function validateId(req, res, next) {
    const userId = req.params.userId;
    const orderId = req.params.orderId;
    const id = userId || orderId;
    
    if (!id) {
        return next();
    }
    
    if (!/^[a-zA-Z0-9-_]+$/.test(id)) {
        logger.warn('Invalid ID format', { id });
        return res.status(400).json({ 
            error: 'Invalid ID format',
            message: 'ID can only contain letters, numbers, hyphens, and underscores'
        });
    }
    
    next();
}

function asyncHandler(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (error) {
            logger.error('Unhandled error in route handler', error, {
                url: req.url,
                method: req.method
            });
            next(error);
        }
    };
}

// ========== ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК ==========
app.use((error, req, res, next) => {
    logger.error('Global error handler caught error', error, {
        url: req.url,
        method: req.method
    });
    
    if (error.message && error.message.includes('circuit')) {
        return res.status(503).json({
            error: 'Service temporarily unavailable',
            timestamp: new Date().toISOString(),
            requestId: req.id || Math.random().toString(36).substr(2, 9)
        });
    }
    
    res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
        requestId: req.id || Math.random().toString(36).substr(2, 9)
    });
});

// ========== МАРШРУТЫ ==========
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
        config: {
            usersServiceUrl: CONFIG.SERVICES.USERS.URL,
            ordersServiceUrl: CONFIG.SERVICES.ORDERS.URL
        },
        circuits: {
            users: {
                status: usersCircuit.status,
                stats: usersCircuit.stats
            },
            orders: {
                status: ordersCircuit.status,
                stats: ordersCircuit.stats
            }
        }
    });
});

app.get('/status', (req, res) => {
    res.json({ 
        status: 'API Gateway is running',
        timestamp: new Date().toISOString()
    });
});

// ========== ОБРАБОТКА 404 ==========
app.use('*', (req, res) => {
    logger.warn('Route not found', { url: req.originalUrl });
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    });
});

// ========== ЗАПУСК СЕРВЕРА ==========
app.listen(PORT, () => {
    logger.info(`API Gateway started successfully`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        services: {
            users: CONFIG.SERVICES.USERS.URL,
            orders: CONFIG.SERVICES.ORDERS.URL
        }
    });
});

module.exports = app;