const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');

const app = express();
const PORT = process.env.PORT || 8000;

// ========== ШАГ 1: Выносим конфигурацию ==========
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

// ========== ШАГ 1: Создаем фабрику Circuit Breaker ==========
function createCircuitBreaker() {
    const options = {
        timeout: CONFIG.CIRCUIT_BREAKER.TIMEOUT,
        errorThresholdPercentage: CONFIG.CIRCUIT_BREAKER.ERROR_THRESHOLD_PERCENTAGE,
        resetTimeout: CONFIG.CIRCUIT_BREAKER.RESET_TIMEOUT,
    };

    return new CircuitBreaker(async (url, options = {}) => {
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
}

// Create circuit breakers for each service
const usersCircuit = createCircuitBreaker();
const ordersCircuit = createCircuitBreaker();

// Fallback functions
usersCircuit.fallback(() => ({ error: 'Users service temporarily unavailable' }));
ordersCircuit.fallback(() => ({ error: 'Orders service temporarily unavailable' }));

// ========== ШАГ 1: Вспомогательные функции ==========
function makeRequest(circuit, serviceUrl, path, method = 'GET', data = null) {
    const url = `${serviceUrl}${path}`;
    const options = { method };
    
    if (data && (method === 'POST' || method === 'PUT')) {
        options.data = data;
    }
    
    return circuit.fire(url, options);
}

// Routes with Circuit Breaker
app.get('/users/:userId', async (req, res) => {
    try {
        const user = await makeRequest(
            usersCircuit, 
            CONFIG.SERVICES.USERS.URL, 
            `/users/${req.params.userId}`
        );
        
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
        const user = await makeRequest(
            usersCircuit,
            CONFIG.SERVICES.USERS.URL,
            '/users',
            'POST',
            req.body
        );
        res.status(201).json(user);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await makeRequest(
            usersCircuit,
            CONFIG.SERVICES.USERS.URL,
            '/users'
        );
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/users/:userId', async (req, res) => {
    try {
        const result = await makeRequest(
            usersCircuit,
            CONFIG.SERVICES.USERS.URL,
            `/users/${req.params.userId}`,
            'DELETE'
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/users/:userId', async (req, res) => {
    try {
        const user = await makeRequest(
            usersCircuit,
            CONFIG.SERVICES.USERS.URL,
            `/users/${req.params.userId}`,
            'PUT',
            req.body
        );
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== Остальные маршруты остаются пока без изменений ==========
// Orders routes (пока оставляем как есть для безопасности)
app.get('/orders/:orderId', async (req, res) => {
    try {
        const order = await ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders/${req.params.orderId}`);
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
        const order = await ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders`, {
            method: 'POST',
            data: req.body
        });
        res.status(201).json(order);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/orders', async (req, res) => {
    try {
        const orders = await ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders`);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/orders/:orderId', async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders/${req.params.orderId}`, {
            method: 'DELETE'
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/orders/:orderId', async (req, res) => {
    try {
        const order = await ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders/${req.params.orderId}`, {
            method: 'PUT',
            data: req.body
        });
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/orders/status', async (req, res) => {
    try {
        const status = await ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders/status`);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/orders/health', async (req, res) => {
    try {
        const health = await ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders/health`);
        res.json(health);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Gateway Aggregation: Get user details with their orders
app.get('/users/:userId/details', async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get user details
        const userPromise = usersCircuit.fire(`${CONFIG.SERVICES.USERS.URL}/users/${userId}`);

        // Get user's orders (assuming orders have a userId field)
        const ordersPromise = ordersCircuit.fire(`${CONFIG.SERVICES.ORDERS.URL}/orders`)
            .then(orders => orders.filter(order => order.userId == userId));

        // Wait for both requests to complete
        const [user, userOrders] = await Promise.all([userPromise, ordersPromise]);

        // If user not found, return 404
        if (user.error === 'User not found') {
            return res.status(404).json(user);
        }

        // Return aggregated response
        res.json({
            user,
            orders: userOrders
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint that shows circuit breaker status
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