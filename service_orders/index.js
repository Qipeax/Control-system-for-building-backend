const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;

// ========== ШАГ 1: Конфигурация ==========
const CONFIG = {
    PORT: process.env.PORT || 8000,
    DB: {
        INITIAL_ID: 1
    }
};

// Middleware
app.use(cors());
app.use(express.json());

// ========== ШАГ 1: Модуль базы данных ==========
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

// ========== ШАГ 1: Маршруты (пока без изменений) ==========
app.get('/orders/status', (req, res) => {
    res.json({status: 'Orders service is running'});
});

app.get('/orders/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Orders Service',
        timestamp: new Date().toISOString()
    });
});

app.get('/orders/:orderId', (req, res) => {
    const orderId = parseInt(req.params.orderId);
    const order = ordersDB.getById(orderId);

    if (!order) {
        return res.status(404).json({error: 'Order not found'});
    }

    res.json(order);
});

app.get('/orders', (req, res) => {
    let orders;
    
    if (req.query.userId) {
        const userId = parseInt(req.query.userId);
        orders = ordersDB.filterByUserId(userId);
    } else {
        orders = ordersDB.getAll();
    }

    res.json(orders);
});

app.post('/orders', (req, res) => {
    const orderData = req.body;
    const newOrder = ordersDB.create(orderData);
    res.status(201).json(newOrder);
});

app.put('/orders/:orderId', (req, res) => {
    const orderId = parseInt(req.params.orderId);
    const orderData = req.body;

    const updatedOrder = ordersDB.update(orderId, orderData);
    
    if (!updatedOrder) {
        return res.status(404).json({error: 'Order not found'});
    }

    res.json(updatedOrder);
});

app.delete('/orders/:orderId', (req, res) => {
    const orderId = parseInt(req.params.orderId);
    const deletedOrder = ordersDB.delete(orderId);

    if (!deletedOrder) {
        return res.status(404).json({error: 'Order not found'});
    }

    res.json({message: 'Order deleted', deletedOrder});
});

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`Orders service running on port ${CONFIG.PORT}`);
});