const express = require("express");
const cors = require("cors");
const axios = require("axios");
const CircuitBreaker = require("opossum");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const Joi = require("joi");

const app = express();
const PORT = process.env.PORT || 8000;
// Конфигурация
const config = {
  services: {
    users: {
      url: process.env.USERS_SERVICE_URL || "http://service_users:8000",
      timeout: parseInt(process.env.USERS_SERVICE_TIMEOUT) || 3000,
    },
    orders: {
      url: process.env.ORDERS_SERVICE_URL || "http://service_orders:8000",
      timeout: parseInt(process.env.ORDERS_SERVICE_TIMEOUT) || 3000,
    },
  },
  circuitBreaker: {
    timeout: parseInt(process.env.CIRCUIT_TIMEOUT) || 3000,
    errorThresholdPercentage:
      parseInt(process.env.CIRCUIT_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CIRCUIT_RESET_TIMEOUT) || 30000,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов за окно
  },
};
// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit(config.rateLimit));

// Логирование
const logger = {
    info: (message, meta = {}) => console.log(`[INFO] ${new Date().toISOString()} - ${message}`, meta),
    warn: (message, meta = {}) => console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, meta),
    error: (message, meta = {}) => console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, meta)
};


// Create circuit breakers for each service

class CircuitBreakerFactory {
    constructor(options) {
        this.defaultOptions = options;
    }

    create(serviceName) {
        const circuit = new CircuitBreaker(this.createRequestFunction(), {
            ...this.defaultOptions,
            name: serviceName
        });

        circuit.fallback(() => this.createFallbackResponse(serviceName));
        this.setupEventListeners(circuit, serviceName);
        
        return circuit;
    }

    createRequestFunction() {
        return async (url, options = {}) => {
            try {
                const response = await axios({
                    url,
                    ...options,
                    validateStatus: status => (status >= 200 && status < 300) || status === 404,
                    timeout: config.circuitBreaker.timeout
                });
                return response.data;
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    return error.response.data;
                }
                throw error;
            }
        };
    }

    createFallbackResponse(serviceName) {
        return {
            error: `${serviceName} service temporarily unavailable`,
            timestamp: new Date().toISOString()
        };
    }

    setupEventListeners(circuit, serviceName) {
        circuit.on('open', () => 
            logger.warn(`Circuit breaker for ${serviceName} opened`));
        circuit.on('close', () => 
            logger.info(`Circuit breaker for ${serviceName} closed`));
        circuit.on('halfOpen', () => 
            logger.info(`Circuit breaker for ${serviceName} half-open`));
        circuit.on('failure', (error) => 
            logger.error(`Circuit breaker for ${serviceName} failure:`, error));
    }
}

app.listen(PORT, () => {
    logger.info(`API Gateway running on port ${PORT}`);
});