const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// JWT
const JWT_SECRET = process.env.JWT_SECRET || '88005553535';

// In-memory database
let usersDb = {};
let currentId = 1;

// Validation schemas
const registerSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    name: Joi.string().min(2).max(50).required()
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
});

const updateProfileSchema = Joi.object({
    name: Joi.string().min(2).max(50),
    email: Joi.string().email()
}).min(1);

// Helper functions
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            roles: user.roles
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

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

// Routes
// Health check
app.get('/api/v1/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'OK',
            service: 'Users Service',
            timestamp: new Date().toISOString()
        }
    });
});

// Register
app.post('/api/v1/auth/register', async (req, res) => {
    try {
        // Validate input
        const { error, value } = registerSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: error.details[0].message }
            });
        }

        const { email, password, name } = value;

        // Check if user already exists
        const existingUser = Object.values(usersDb).find(user => user.email === email);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: { code: 'USER_EXISTS', message: 'Пользователь с таким email уже существует' }
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const userId = uuidv4();
        const newUser = {
            id: userId,
            email,
            passwordHash: hashedPassword,
            name,
            roles: ['user'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        usersDb[userId] = newUser;

        // Generate token
        const token = generateToken(newUser);

        res.status(201).json({
            success: true,
            data: {
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    name: newUser.name,
                    roles: newUser.roles,
                    createdAt: newUser.createdAt
                },
                token
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при регистрации' }
        });
    }
});

// Login
app.post('/api/v1/auth/login', async (req, res) => {
    try {
        // Validate input
        const { error, value } = loginSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: error.details[0].message }
            });
        }

        const { email, password } = value;

        // Find user
        const user = Object.values(usersDb).find(user => user.email === email);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: { code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль' }
            });
        }

        // Check password
        const passwordMatch = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: { code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль' }
            });
        }

        // Generate token
        const token = generateToken(user);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    roles: user.roles,
                    createdAt: user.createdAt
                },
                token
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при входе' }
        });
    }
});

// Get current user profile
app.get('/api/v1/users/me', authenticateToken, (req, res) => {
    try {
        const user = usersDb[req.user.id];
        if (!user) {
            return res.status(404).json({
                success: false,
                error: { code: 'USER_NOT_FOUND', message: 'Пользователь не найден' }
            });
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                name: user.name,
                roles: user.roles,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при получении профиля' }
        });
    }
});

// Update current user profile
app.put('/api/v1/users/me', authenticateToken, async (req, res) => {
    try {
        // Validate input
        const { error, value } = updateProfileSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: error.details[0].message }
            });
        }

        const user = usersDb[req.user.id];
        if (!user) {
            return res.status(404).json({
                success: false,
                error: { code: 'USER_NOT_FOUND', message: 'Пользователь не найден' }
            });
        }

        // Check if email is being changed to an existing one
        if (value.email && value.email !== user.email) {
            const existingUser = Object.values(usersDb).find(u => u.email === value.email && u.id !== user.id);
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    error: { code: 'EMAIL_EXISTS', message: 'Email уже используется другим пользователем' }
                });
            }
        }

        // Update user
        const updatedUser = {
            ...user,
            ...value,
            updatedAt: new Date().toISOString()
        };

        usersDb[user.id] = updatedUser;

        res.json({
            success: true,
            data: {
                id: updatedUser.id,
                email: updatedUser.email,
                name: updatedUser.name,
                roles: updatedUser.roles,
                createdAt: updatedUser.createdAt,
                updatedAt: updatedUser.updatedAt
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при обновлении профиля' }
        });
    }
});

// Get all users (admin only)
app.get('/api/v1/users', authenticateToken, (req, res) => {
    try {
        // Check if user is admin
        if (!req.user.roles.includes('admin')) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Недостаточно прав' }
            });
        }

        const { page = 1, limit = 10, email, role } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        // Filter users
        let filteredUsers = Object.values(usersDb);
        
        if (email) {
            filteredUsers = filteredUsers.filter(user => 
                user.email.toLowerCase().includes(email.toLowerCase())
            );
        }
        
        if (role) {
            filteredUsers = filteredUsers.filter(user => 
                user.roles.includes(role)
            );
        }

        // Pagination
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = pageNum * limitNum;
        const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

        // Map to response format (excluding sensitive data)
        const usersData = paginatedUsers.map(user => ({
            id: user.id,
            email: user.email,
            name: user.name,
            roles: user.roles,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        }));

        res.json({
            success: true,
            data: {
                users: usersData,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: filteredUsers.length,
                    totalPages: Math.ceil(filteredUsers.length / limitNum)
                }
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Ошибка при получении пользователей' }
        });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Users service running on port ${PORT}`);
    
    // Create admin user if not exists
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    const existingAdmin = Object.values(usersDb).find(user => user.email === adminEmail);
    if (!existingAdmin) {
        bcrypt.hash(adminPassword, 10).then(hashedPassword => {
            const adminId = uuidv4();
            usersDb[adminId] = {
                id: adminId,
                email: adminEmail,
                passwordHash: hashedPassword,
                name: 'Administrator',
                roles: ['admin', 'user'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            console.log('Admin user created:', adminEmail);
        });
    }
});