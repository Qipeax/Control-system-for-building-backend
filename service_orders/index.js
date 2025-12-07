const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;

// ========== ШАГ 3: Конфигурация ==========
const CONFIG = {
    PORT: process.env.PORT || 8000,
    DB: {
        INITIAL_ID: 1
    },
    VALIDATION: {
        MAX_PRODUCT_LENGTH: 255,
        MIN_QUANTITY: 1,
        MIN_PRICE: 0
    },
    LOGGING: {
        LEVEL: process.env.LOG_LEVEL || 'info'
    }
};

// ========== ШАГ 3: Логирование ==========
const logger = {
    info: (message, meta = {}) => {
        console.log(JSON.stringify({
            level: 'INFO',
            timestamp: new Date().toISOString(),
            message,
            ...meta
        }));
    },
    
    error: (message, error = null, meta = {}) => {
        console.error(JSON.stringify({
            level: 'ERROR',
            timestamp: new Date().toISOString(),
            message,
            error: error ? error.message : null,
            stack: error ? error.stack : null,
            ...meta
        }));
    },
    
    warn: (message, meta = {}) => {
        console.warn(JSON.stringify({
            level: 'WARN',
            timestamp: new Date().toISOString(),
            message,
            ...meta
        }));
    }
};

// Middleware
app.use(cors());
app.use(express.json());

// ========== ШАГ 3: Middleware для логирования запросов ==========
app.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substr(2, 9);
    
    // Сохраняем requestId для использования в логах
    req.requestId = requestId;
    
    logger.info('Request started', {
        requestId,
        method: req.method,
        url: req.url,
        ip: req.ip
    });
    
    // Перехватываем отправку ответа
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - startTime;
        
        logger.info('Request completed', {
            requestId,
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`
        });
        
        return originalSend.call(this, data);
    };
    
    next();
});

// ========== ШАГ 3: Модуль базы данных ==========
class InMemoryDB {
    constructor() {
        this.data = {};
        this.currentId = CONFIG.DB.INITIAL_ID;
    }

    getAll() {
        return Object.values(this.data);
    }

    getById(id) {
        return this.data[id];
    }

    create(item) {
        const id = this.currentId++;
        const newItem = { id, ...item };
        this.data[id] = newItem;
        return newItem;
    }

    update(id, updates) {
        if (!this.data[id]) {
            return null;
        }
        this.data[id] = { id, ...updates };
        return this.data[id];
    }

    delete(id) {
        if (!this.data[id]) {
            return null;
        }
        const deletedItem = this.data[id];
        delete this.data[id];
        return deletedItem;
    }

    filterByUserId(userId) {
        return Object.values(this.data).filter(item => item.userId === userId);
    }

    count() {
        return Object.keys(this.data).length;
    }
}

// ========== ШАГ 3: Сервисный слой ==========
class OrdersService {
    constructor(db) {
        this.db = db;
    }
    
    getOrder(orderId) {
        logger.info('Getting order', { orderId });
        return this.db.getById(orderId);
    }
    
    getAllOrders(userId = null) {
        logger.info('Getting all orders', { userId: userId || 'none' });
        
        if (userId) {
            return this.db.filterByUserId(userId);
        }
        
        return this.db.getAll();
    }
    
    createOrder(orderData) {
        logger.info('Creating new order', { orderData });
        return this.db.create(orderData);
    }
    
    updateOrder(orderId, orderData) {
        logger.info('Updating order', { orderId, orderData });
        return this.db.update(orderId, orderData);
    }
    
    deleteOrder(orderId) {
        logger.info('Deleting order', { orderId });
        return this.db.delete(orderId);
    }
    
    getStats() {
        const count = this.db.count();
        const allOrders = this.db.getAll();
        
        const stats = {
            totalOrders: count,
            totalValue: allOrders.reduce((sum, order) => sum + (order.price || 0) * (order.quantity || 1), 0),
            averageOrderValue: count > 0 ? 
                allOrders.reduce((sum, order) => sum + (order.price || 0), 0) / count : 0
        };
        
        logger.info('Getting service stats', stats);
        return stats;
    }
}

// ========== ШАГ 3: Валидация (обновленная) ==========
class OrderValidator {
    static validateOrderData(orderData, isUpdate = false) {
        const errors = [];
        
        if (!isUpdate || orderData.product !== undefined) {
            if (!orderData.product || typeof orderData.product !== 'string') {
                errors.push('Product must be a non-empty string');
            } else if (orderData.product.length > CONFIG.VALIDATION.MAX_PRODUCT_LENGTH) {
                errors.push(`Product name cannot exceed ${CONFIG.VALIDATION.MAX_PRODUCT_LENGTH} characters`);
            }
        }
        
        if (!isUpdate || orderData.quantity !== undefined) {
            if (typeof orderData.quantity !== 'number' || orderData.quantity < CONFIG.VALIDATION.MIN_QUANTITY) {
                errors.push(`Quantity must be a number >= ${CONFIG.VALIDATION.MIN_QUANTITY}`);
            }
        }
        
        if (!isUpdate || orderData.price !== undefined) {
            if (typeof orderData.price !== 'number' || orderData.price < CONFIG.VALIDATION.MIN_PRICE) {
                errors.push(`Price must be a number >= ${CONFIG.VALIDATION.MIN_PRICE}`);
            }
        }
        
        if (!isUpdate || orderData.userId !== undefined) {
            if (typeof orderData.userId !== 'number' || orderData.userId <= 0) {
                errors.push('userId must be a positive number');
            }
        }
        
        return errors;
    }
    
    static validateOrderId(orderId) {
        const errors = [];
        const id = parseInt(orderId);
        
        if (isNaN(id)) {
            errors.push('Order ID must be a valid number');
        } else if (id <= 0) {
            errors.push('Order ID must be a positive number');
        }
        
        return { isValid: errors.length === 0, id, errors };
    }
    
    static validateUserId(userId) {
        const errors = [];
        const id = parseInt(userId);
        
        if (isNaN(id)) {
            errors.push('User ID must be a valid number');
        } else if (id <= 0) {
            errors.push('User ID must be a positive number');
        }
        
        return { isValid: errors.length === 0, id, errors };
    }
}

// ========== ШАГ 3: Контроллер (обновленный) ==========
class OrdersController {
    constructor(service) {
        this.service = service;
    }
    
    getStatus(req, res) {
        res.json({ 
            status: 'Orders service is running',
            timestamp: new Date().toISOString()
        });
    }
    
    getHealth(req, res) {
        const stats = this.service.getStats();
        
        res.json({
            status: 'OK',
            service: 'Orders Service',
            timestamp: new Date().toISOString(),
            dbCount: stats.totalOrders,
            stats
        });
    }
    
    getOrder(req, res) {
        const validation = OrderValidator.validateOrderId(req.params.orderId);
        
        if (!validation.isValid) {
            logger.warn('Invalid order ID', { 
                requestId: req.requestId,
                orderId: req.params.orderId,
                errors: validation.errors 
            });
            
            return res.status(400).json({ 
                error: 'Invalid order ID', 
                details: validation.errors 
            });
        }
        
        const order = this.service.getOrder(validation.id);
        
        if (!order) {
            logger.warn('Order not found', { 
                requestId: req.requestId,
                orderId: validation.id 
            });
            
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(order);
    }
    
    getAllOrders(req, res) {
        if (req.query.userId) {
            const validation = OrderValidator.validateUserId(req.query.userId);
            
            if (!validation.isValid) {
                logger.warn('Invalid user ID', { 
                    requestId: req.requestId,
                    userId: req.query.userId,
                    errors: validation.errors 
                });
                
                return res.status(400).json({ 
                    error: 'Invalid user ID', 
                    details: validation.errors 
                });
            }
            
            const orders = this.service.getAllOrders(validation.id);
            res.json(orders);
        } else {
            const orders = this.service.getAllOrders();
            res.json(orders);
        }
    }
    
    createOrder(req, res) {
        const validationErrors = OrderValidator.validateOrderData(req.body);
        
        if (validationErrors.length > 0) {
            logger.warn('Order validation failed', { 
                requestId: req.requestId,
                errors: validationErrors,
                data: req.body 
            });
            
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: validationErrors 
            });
        }
        
        try {
            const newOrder = this.service.createOrder(req.body);
            
            logger.info('Order created successfully', { 
                requestId: req.requestId,
                orderId: newOrder.id 
            });
            
            res.status(201).json(newOrder);
        } catch (error) {
            logger.error('Failed to create order', error, { 
                requestId: req.requestId,
                data: req.body 
            });
            
            res.status(500).json({ error: 'Failed to create order' });
        }
    }
    
    updateOrder(req, res) {
        const idValidation = OrderValidator.validateOrderId(req.params.orderId);
        
        if (!idValidation.isValid) {
            logger.warn('Invalid order ID for update', { 
                requestId: req.requestId,
                orderId: req.params.orderId,
                errors: idValidation.errors 
            });
            
            return res.status(400).json({ 
                error: 'Invalid order ID', 
                details: idValidation.errors 
            });
        }
        
        const dataValidationErrors = OrderValidator.validateOrderData(req.body, true);
        
        if (dataValidationErrors.length > 0) {
            logger.warn('Order update validation failed', { 
                requestId: req.requestId,
                orderId: idValidation.id,
                errors: dataValidationErrors 
            });
            
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: dataValidationErrors 
            });
        }
        
        const updatedOrder = this.service.updateOrder(idValidation.id, req.body);
        
        if (!updatedOrder) {
            logger.warn('Order not found for update', { 
                requestId: req.requestId,
                orderId: idValidation.id 
            });
            
            return res.status(404).json({ error: 'Order not found' });
        }
        
        logger.info('Order updated successfully', { 
            requestId: req.requestId,
            orderId: idValidation.id 
        });
        
        res.json(updatedOrder);
    }
    
    deleteOrder(req, res) {
        const validation = OrderValidator.validateOrderId(req.params.orderId);
        
        if (!validation.isValid) {
            logger.warn('Invalid order ID for deletion', { 
                requestId: req.requestId,
                orderId: req.params.orderId,
                errors: validation.errors 
            });
            
            return res.status(400).json({ 
                error: 'Invalid order ID', 
                details: validation.errors 
            });
        }
        
        const deletedOrder = this.service.deleteOrder(validation.id);
        
        if (!deletedOrder) {
            logger.warn('Order not found for deletion', { 
                requestId: req.requestId,
                orderId: validation.id 
            });
            
            return res.status(404).json({ error: 'Order not found' });
        }
        
        logger.info('Order deleted successfully', { 
            requestId: req.requestId,
            orderId: validation.id 
        });
        
        res.json({ 
            message: 'Order deleted', 
            deletedOrder
        });
    }
}

// ========== ШАГ 3: Middleware для обработки ошибок ==========
function asyncHandler(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (error) {
            logger.error('Unhandled error in route handler', error, {
                requestId: req.requestId,
                url: req.url,
                method: req.method
            });
            next(error);
        }
    };
}

app.use((error, req, res, next) => {
    logger.error('Global error handler caught error', error, {
        requestId: req.requestId,
        url: req.url,
        method: req.method
    });
    
    res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
        requestId: req.requestId
    });
});

// ========== ШАГ 3: Инициализация ==========
const ordersDB = new InMemoryDB();
const ordersService = new OrdersService(ordersDB);
const ordersController = new OrdersController(ordersService);

// ========== ШАГ 3: Маршруты с asyncHandler ==========
app.get('/orders/status', asyncHandler((req, res) => ordersController.getStatus(req, res)));
app.get('/orders/health', asyncHandler((req, res) => ordersController.getHealth(req, res)));
app.get('/orders/:orderId', asyncHandler((req, res) => ordersController.getOrder(req, res)));
app.get('/orders', asyncHandler((req, res) => ordersController.getAllOrders(req, res)));
app.post('/orders', asyncHandler((req, res) => ordersController.createOrder(req, res)));
app.put('/orders/:orderId', asyncHandler((req, res) => ordersController.updateOrder(req, res)));
app.delete('/orders/:orderId', asyncHandler((req, res) => ordersController.deleteOrder(req, res)));

// ========== ШАГ 3: Обработка 404 ==========
app.use('*', (req, res) => {
    logger.warn('Route not found', { 
        requestId: req.requestId,
        url: req.originalUrl 
    });
    
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
        requestId: req.requestId
    });
});

// Start server
app.listen(CONFIG.PORT, () => {
    logger.info('Orders service started', {
        port: CONFIG.PORT,
        environment: process.env.NODE_ENV || 'development'
    });
});