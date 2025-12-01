const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');

const app = express();
const PORT = process.env.PORT || 8000;

// ========== ШАГ 1 + ШАГ 2 ==========
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

// Middleware
app.use(cors());
app.use(express.json());

// ========== ШАГ 2: Создаем базовый Service класс ==========
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

// ========== ШАГ 2: Создаем UserService ==========
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

// ========== ШАГ 2: Создаем OrderService ==========
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
        // Проверяем, что allOrders - массив
        if (Array.isArray(allOrders)) {
            return allOrders.filter(order => order.userId == userId);
        }
        return [];
    }
}

// ========== ШАГ 2: Фабрика Circuit Breaker ==========
function createCircuitBreaker() {
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

    // Добавляем fallback позже, когда будем знать имя сервиса
    return circuit;
}

// ========== ШАГ 2: Инициализация сервисов ==========
const usersCircuit = createCircuitBreaker();
const ordersCircuit = createCircuitBreaker();

// Создаем экземпляры сервисов
const userService = new UserService(usersCircuit);
const orderService = new OrderService(ordersCircuit);

// Настраиваем fallback с использованием сервисов
usersCircuit.fallback(() => ({ error: userService.getFallbackMessage() }));
ordersCircuit.fallback(() => ({ error: orderService.getFallbackMessage() }));

// ========== ШАГ 2: Обновляем маршруты ==========
// User routes (используем UserService)
app.get('/users/:userId', async (req, res) => {
    try {
        const user = await userService.getUser(req.params.userId);
        if (user.error === 'User not found') {
            res.status(404).json(user);
        } else {
            res.json(user);
        }
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/users', async (req, res) => {
    try {
        const user = await userService.createUser(req.body);
        res.status(201).json(user);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await userService.getAllUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/users/:userId', async (req, res) => {
    try {
        const result = await userService.deleteUser(req.params.userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/users/:userId', async (req, res) => {
    try {
        const user = await userService.updateUser(req.params.userId, req.body);
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Order routes (используем OrderService)
app.get('/orders/:orderId', async (req, res) => {
    try {
        const order = await orderService.getOrder(req.params.orderId);
        if (order.error === 'Order not found') {
            res.status(404).json(order);
        } else {
            res.json(order);
        }
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/orders', async (req, res) => {
    try {
        const order = await orderService.createOrder(req.body);
        res.status(201).json(order);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/orders', async (req, res) => {
    try {
        const orders = await orderService.getAllOrders();
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/orders/:orderId', async (req, res) => {
    try {
        const result = await orderService.deleteOrder(req.params.orderId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/orders/:orderId', async (req, res) => {
    try {
        const order = await orderService.updateOrder(req.params.orderId, req.body);
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/orders/status', async (req, res) => {
    try {
        const status = await orderService.getStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/orders/health', async (req, res) => {
    try {
        const health = await orderService.getHealth();
        res.json(health);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Gateway Aggregation (используем оба сервиса)
app.get('/users/:userId/details', async (req, res) => {
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
            orders: userOrders
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'API Gateway is running',
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
    res.json({ status: 'API Gateway is running' });
});

// Start server
app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);

    // Log circuit breaker events for monitoring
    usersCircuit.on('open', () => console.log('Users circuit breaker opened'));
    usersCircuit.on('close', () => console.log('Users circuit breaker closed'));
    usersCircuit.on('halfOpen', () => console.log('Users circuit breaker half-open'));

    ordersCircuit.on('open', () => console.log('Orders circuit breaker opened'));
    ordersCircuit.on('close', () => console.log('Orders circuit breaker closed'));
    ordersCircuit.on('halfOpen', () => console.log('Orders circuit breaker half-open'));
});