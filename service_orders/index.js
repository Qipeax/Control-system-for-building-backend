const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || '88005553535';

// In-memory database
let ordersDb = {};
let usersServiceUrl = process.env.USERS_SERVICE_URL || 'http://service_users:8000';

// Order statuses
const ORDER_STATUSES = {
    CREATED: 'created',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

// Validation schemas
const createOrderSchema = Joi.object({
    items: Joi.array().items(
        Joi.object({
            productId: Joi.string().required(),
            name: Joi.string().required(),
            quantity: Joi.number().integer().min(1).required(),
            price: Joi.number().positive().required()
        })
    ).min(1).required(),
    totalAmount: Joi.number().positive().required()
});

const updateOrderSchema = Joi.object({
    status: Joi.string().valid(...Object.values(ORDER_STATUSES))
});

// Helper functions
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

const authorizeOrderAccess = (req, res, next) => {
    const orderId = req.params.orderId || req.body.orderId;
    const order = ordersDb[orderId];

    if (!order) {
        return res.status(404).json({
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: 'Заказ не найден' }
        });
    }

    // Allow admin to access any order
    if (req.user.roles.includes('admin')) {
        req.order = order;
        return next();
    }

    // Check if user owns the order
    if (order.userId !== req.user.id) {
        return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Нет доступа к этому заказу' }
        });
    }

    req.order = order;
    next();
};

// Routes
// Health check
app.get('/api/v1/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'OK',
            service: 'Orders Service',
            timestamp: new Date().toISOString()
        }
    });
});

// Get all orders for current user
app.get('/api/v1/orders', authenticateToken, (req, res) => {
    try {
        const { page = 1, limit = 10, status, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        // Filter orders
        let filteredOrders = Object.values(ordersDb);
        
        // Non-admin users can only see their own orders
        if (!req.user.roles.includes('admin')) {
            filteredOrders = filteredOrders.filter(order => order.userId === req.user.id);
        }
        
        if (status) {
            filteredOrders = filteredOrders.filter(order => order.status === status);
        }

        // Sort orders
        filteredOrders.sort((a, b) => {
            const aValue = a[sortBy];
            const bValue = b[sortBy];
            const direction = sortOrder === 'asc' ? 1 : -1;
            
            if (aValue < bValue) return -1 * direction;
            if (aValue > bValue) return 1 * direction;
            return 0;
        });

        // Pagination
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = pageNum * limitNum;
        const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

        // Map to response format
        const ordersData = paginatedOrders.map(order => ({
            id: order.id,
            userId: order.userId,
            items: order.items,
            status: order.status,
            totalAmount: order.totalAmount,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
        }));

        res.json({
            success: true,
            data: {
                orders: ordersData,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: filteredOrders.length,
                    totalPages: Math.ceil(filteredOrders.length / limitNum)
                }
            }
        });
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при получении заказов' }
        });
    }
});

// Create new order
app.post('/api/v1/orders', authenticateToken, async (req, res) => {
    try {
        // Validate input
        const { error, value } = createOrderSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: error.details[0].message }
            });
        }

        const { items, totalAmount } = value;

        // Verify total amount matches items
        const calculatedTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (Math.abs(calculatedTotal - totalAmount) > 0.01) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_TOTAL', message: 'Сумма заказа не соответствует позициям' }
            });
        }

        // Create order
        const orderId = uuidv4();
        const newOrder = {
            id: orderId,
            userId: req.user.id,
            items,
            status: ORDER_STATUSES.CREATED,
            totalAmount,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        ordersDb[orderId] = newOrder;

        // Publish order created event (placeholder for message broker)
        console.log(`Order created event: ${orderId} for user ${req.user.id}`);

        res.status(201).json({
            success: true,
            data: {
                order: {
                    id: newOrder.id,
                    userId: newOrder.userId,
                    items: newOrder.items,
                    status: newOrder.status,
                    totalAmount: newOrder.totalAmount,
                    createdAt: newOrder.createdAt
                }
            }
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при создании заказа' }
        });
    }
});

// Get order by ID
app.get('/api/v1/orders/:orderId', authenticateToken, authorizeOrderAccess, (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                order: {
                    id: req.order.id,
                    userId: req.order.userId,
                    items: req.order.items,
                    status: req.order.status,
                    totalAmount: req.order.totalAmount,
                    createdAt: req.order.createdAt,
                    updatedAt: req.order.updatedAt
                }
            }
        });
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при получении заказа' }
        });
    }
});

// Update order (status update)
app.put('/api/v1/orders/:orderId', authenticateToken, authorizeOrderAccess, (req, res) => {
    try {
        // Validate input
        const { error, value } = updateOrderSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: error.details[0].message }
            });
        }

        const { status } = value;

        // Check if status transition is valid
        const validTransitions = {
            [ORDER_STATUSES.CREATED]: [ORDER_STATUSES.IN_PROGRESS, ORDER_STATUSES.CANCELLED],
            [ORDER_STATUSES.IN_PROGRESS]: [ORDER_STATUSES.COMPLETED, ORDER_STATUSES.CANCELLED],
            [ORDER_STATUSES.COMPLETED]: [],
            [ORDER_STATUSES.CANCELLED]: []
        };

        if (!validTransitions[req.order.status].includes(status)) {
            return res.status(400).json({
                success: false,
                error: { 
                    code: 'INVALID_STATUS_TRANSITION', 
                    message: `Невозможно изменить статус с ${req.order.status} на ${status}` 
                }
            });
        }

        // Update order
        const updatedOrder = {
            ...req.order,
            status,
            updatedAt: new Date().toISOString()
        };

        ordersDb[req.order.id] = updatedOrder;

        // Publish status updated event
        console.log(`Order status updated event: ${req.order.id} from ${req.order.status} to ${status}`);

        res.json({
            success: true,
            data: {
                order: {
                    id: updatedOrder.id,
                    userId: updatedOrder.userId,
                    status: updatedOrder.status,
                    totalAmount: updatedOrder.totalAmount,
                    createdAt: updatedOrder.createdAt,
                    updatedAt: updatedOrder.updatedAt
                }
            }
        });
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при обновлении заказа' }
        });
    }
});

// Cancel order
app.delete('/api/v1/orders/:orderId', authenticateToken, authorizeOrderAccess, (req, res) => {
    try {
        // Check if order can be cancelled
        if (req.order.status === ORDER_STATUSES.COMPLETED) {
            return res.status(400).json({
                success: false,
                error: { 
                    code: 'ORDER_COMPLETED', 
                    message: 'Невозможно отменить выполненный заказ' 
                }
            });
        }

        if (req.order.status === ORDER_STATUSES.CANCELLED) {
            return res.status(400).json({
                success: false,
                error: { 
                    code: 'ORDER_ALREADY_CANCELLED', 
                    message: 'Заказ уже отменён' 
                }
            });
        }

        // Update order status to cancelled
        const updatedOrder = {
            ...req.order,
            status: ORDER_STATUSES.CANCELLED,
            updatedAt: new Date().toISOString()
        };

        ordersDb[req.order.id] = updatedOrder;

        // Publish cancellation event
        console.log(`Order cancelled event: ${req.order.id}`);

        res.json({
            success: true,
            data: {
                message: 'Заказ успешно отменён',
                order: {
                    id: updatedOrder.id,
                    status: updatedOrder.status,
                    updatedAt: updatedOrder.updatedAt
                }
            }
        });
    } catch (error) {
        console.error('Cancel order error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при отмене заказа' }
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Orders service running on port ${PORT}`);
    console.log('Available order statuses:', Object.values(ORDER_STATUSES));
});