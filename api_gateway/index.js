const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Middleware для добавления X-Request-ID
app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
});

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов с одного IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Слишком много запросов' } }
});

app.use(apiLimiter);

// Service URLs
const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL || 'http://service_users:8000';
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL || 'http://service_orders:8000';

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Circuit Breaker configuration
const circuitOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
};

// Helper function для создания circuit breaker с прокидыванием заголовков
const createCircuitBreaker = () => {
    return new CircuitBreaker(async (url, options = {}, requestId) => {
        try {
            const response = await axios({
                url,
                ...options,
                headers: {
                    ...options.headers,
                    'X-Request-ID': requestId,
                    'Content-Type': 'application/json'
                },
                validateStatus: status => (status >= 200 && status < 300) || status === 404
            });
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return error.response.data;
            }
            throw error;
        }
    }, circuitOptions);
};

// Create circuit breakers
const usersCircuit = createCircuitBreaker();
const ordersCircuit = createCircuitBreaker();

// Fallback functions
usersCircuit.fallback(() => ({ 
    success: false, 
    error: { code: 'SERVICE_UNAVAILABLE', message: 'Users service temporarily unavailable' } 
}));

ordersCircuit.fallback(() => ({ 
    success: false, 
    error: { code: 'SERVICE_UNAVAILABLE', message: 'Orders service temporarily unavailable' } 
}));

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Токен не предоставлен' }
        });
    }

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Недействительный токен' }
        });
    }
};

// Middleware для проверки ролей
const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.roles || !roles.some(role => req.user.roles.includes(role))) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Недостаточно прав' }
            });
        }
        next();
    };
};

// Public routes
app.post('/api/v1/auth/register', async (req, res) => {
    try {
        const response = await usersCircuit.fire(
            `${USERS_SERVICE_URL}/api/v1/auth/register`,
            { method: 'POST', data: req.body },
            req.requestId
        );
        res.status(response.success ? 201 : 400).json(response);
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

app.post('/api/v1/auth/login', async (req, res) => {
    try {
        const response = await usersCircuit.fire(
            `${USERS_SERVICE_URL}/api/v1/auth/login`,
            { method: 'POST', data: req.body },
            req.requestId
        );
        res.status(response.success ? 200 : 401).json(response);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

// Protected user routes
app.get('/api/v1/users/me', authenticateToken, async (req, res) => {
    try {
        const response = await usersCircuit.fire(
            `${USERS_SERVICE_URL}/api/v1/users/me`,
            { 
                method: 'GET',
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 200 : 404).json(response);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

app.put('/api/v1/users/me', authenticateToken, async (req, res) => {
    try {
        const response = await usersCircuit.fire(
            `${USERS_SERVICE_URL}/api/v1/users/me`,
            { 
                method: 'PUT',
                data: req.body,
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 200 : 400).json(response);
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

// Admin routes
app.get('/api/v1/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 10, email, role } = req.query;
        const queryParams = new URLSearchParams({ page, limit });
        if (email) queryParams.append('email', email);
        if (role) queryParams.append('role', role);
        
        const response = await usersCircuit.fire(
            `${USERS_SERVICE_URL}/api/v1/users?${queryParams.toString()}`,
            { 
                method: 'GET',
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 200 : 400).json(response);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

// Order routes
app.get('/api/v1/orders', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10, status, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const queryParams = new URLSearchParams({ page, limit, sortBy, sortOrder });
        if (status) queryParams.append('status', status);
        
        const response = await ordersCircuit.fire(
            `${ORDERS_SERVICE_URL}/api/v1/orders?${queryParams.toString()}`,
            { 
                method: 'GET',
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 200 : 400).json(response);
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

app.post('/api/v1/orders', authenticateToken, async (req, res) => {
    try {
        const response = await ordersCircuit.fire(
            `${ORDERS_SERVICE_URL}/api/v1/orders`,
            { 
                method: 'POST',
                data: req.body,
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 201 : 400).json(response);
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

app.get('/api/v1/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const response = await ordersCircuit.fire(
            `${ORDERS_SERVICE_URL}/api/v1/orders/${req.params.orderId}`,
            { 
                method: 'GET',
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 200 : 404).json(response);
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

app.put('/api/v1/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const response = await ordersCircuit.fire(
            `${ORDERS_SERVICE_URL}/api/v1/orders/${req.params.orderId}`,
            { 
                method: 'PUT',
                data: req.body,
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 200 : 400).json(response);
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

app.delete('/api/v1/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const response = await ordersCircuit.fire(
            `${ORDERS_SERVICE_URL}/api/v1/orders/${req.params.orderId}`,
            { 
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}` }
            },
            req.requestId
        );
        res.status(response.success ? 200 : 400).json(response);
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
    }
});

// Health check endpoints
app.get('/api/v1/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'API Gateway is running',
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
            circuits: {
                users: usersCircuit.status,
                orders: ordersCircuit.status
            }
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
    
    // Log circuit breaker events
    usersCircuit.on('open', () => console.warn('Users circuit breaker opened'));
    usersCircuit.on('close', () => console.info('Users circuit breaker closed'));
    usersCircuit.on('halfOpen', () => console.info('Users circuit breaker half-open'));

    ordersCircuit.on('open', () => console.warn('Orders circuit breaker opened'));
    ordersCircuit.on('close', () => console.info('Orders circuit breaker closed'));
    ordersCircuit.on('halfOpen', () => console.info('Orders circuit breaker half-open'));
});