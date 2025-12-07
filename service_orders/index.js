const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;

// ========== ШАГ 2: Конфигурация ==========
const CONFIG = {
    PORT: process.env.PORT || 8000,
    DB: {
        INITIAL_ID: 1
    },
    VALIDATION: {
        MAX_PRODUCT_LENGTH: 255,
        MIN_QUANTITY: 1,
        MIN_PRICE: 0
    }
};

// Middleware
app.use(cors());
app.use(express.json());

// ========== ШАГ 2: Модуль базы данных ==========
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

// Инициализация базы данных
const ordersDB = new InMemoryDB();

// ========== ШАГ 2: Валидация ==========
class OrderValidator {
    static validateOrderData(orderData, isUpdate = false) {
        const errors = [];
        
        // Для создания обязательны все поля
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

// ========== ШАГ 2: Контроллер ==========
class OrdersController {
    constructor(db) {
        this.db = db;
    }
    
    getStatus(req, res) {
        res.json({ status: 'Orders service is running' });
    }
    
    getHealth(req, res) {
        res.json({
            status: 'OK',
            service: 'Orders Service',
            timestamp: new Date().toISOString(),
            dbCount: this.db.count()
        });
    }
    
    getOrder(req, res) {
        const validation = OrderValidator.validateOrderId(req.params.orderId);
        
        if (!validation.isValid) {
            return res.status(400).json({ error: 'Invalid order ID', details: validation.errors });
        }
        
        const order = this.db.getById(validation.id);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(order);
    }
    
    getAllOrders(req, res) {
        if (req.query.userId) {
            const validation = OrderValidator.validateUserId(req.query.userId);
            
            if (!validation.isValid) {
                return res.status(400).json({ error: 'Invalid user ID', details: validation.errors });
            }
            
            const orders = this.db.filterByUserId(validation.id);
            res.json(orders);
        } else {
            const orders = this.db.getAll();
            res.json(orders);
        }
    }
    
    createOrder(req, res) {
        const validationErrors = OrderValidator.validateOrderData(req.body);
        
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: validationErrors 
            });
        }
        
        const newOrder = this.db.create(req.body);
        res.status(201).json(newOrder);
    }
    
    updateOrder(req, res) {
        const idValidation = OrderValidator.validateOrderId(req.params.orderId);
        
        if (!idValidation.isValid) {
            return res.status(400).json({ error: 'Invalid order ID', details: idValidation.errors });
        }
        
        const dataValidationErrors = OrderValidator.validateOrderData(req.body, true);
        
        if (dataValidationErrors.length > 0) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: dataValidationErrors 
            });
        }
        
        const updatedOrder = this.db.update(idValidation.id, req.body);
        
        if (!updatedOrder) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(updatedOrder);
    }
    
    deleteOrder(req, res) {
        const validation = OrderValidator.validateOrderId(req.params.orderId);
        
        if (!validation.isValid) {
            return res.status(400).json({ error: 'Invalid order ID', details: validation.errors });
        }
        
        const deletedOrder = this.db.delete(validation.id);
        
        if (!deletedOrder) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ 
            message: 'Order deleted', 
            deletedOrder,
            remainingOrders: this.db.count()
        });
    }
}

// ========== ШАГ 2: Инициализация контроллера ==========
const ordersController = new OrdersController(ordersDB);

// ========== ШАГ 2: Маршруты с использованием контроллера ==========
app.get('/orders/status', (req, res) => ordersController.getStatus(req, res));
app.get('/orders/health', (req, res) => ordersController.getHealth(req, res));
app.get('/orders/:orderId', (req, res) => ordersController.getOrder(req, res));
app.get('/orders', (req, res) => ordersController.getAllOrders(req, res));
app.post('/orders', (req, res) => ordersController.createOrder(req, res));
app.put('/orders/:orderId', (req, res) => ordersController.updateOrder(req, res));
app.delete('/orders/:orderId', (req, res) => ordersController.deleteOrder(req, res));

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`Orders service running on port ${CONFIG.PORT}`);
});