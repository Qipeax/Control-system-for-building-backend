const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const BASE_URL = 'http://localhost:8000/api/v1';
let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

class TestRunner {
  constructor() {
    this.authTokens = {
      user: null,
      admin: null,
      otherUser: null
    };
    this.ids = {
      userId: null,
      orderId: null,
      otherUserId: null
    };
  }

  async run() {
    console.log('Запуск тестов\n');
    
    try {
      // Проверяем доступность сервисов
      await this.testHealth();
      
      // Запускаем тесты по категориям
      await this.runAuthenticationTests();
      await this.runUserTests();
      await this.runAdminTests();
      await this.runOrderTests();
      await this.runAdvancedTests();
      
      this.printSummary();
    } catch (error) {
      console.error('❌ Ошибка при выполнении тестов:', error.message);
      process.exit(1);
    }
  }

  async testHealth() {
    console.log('🧪 Тест 0: Проверка доступности сервисов');
    try {
      const response = await axios.get(`${BASE_URL}/health`);
      this.recordTest('Health Check', true, 'Сервисы доступны');
      console.log('   ✅ Gateway доступен\n');
    } catch (error) {
      this.recordTest('Health Check', false, 'Gateway недоступен');
      throw new Error('Gateway недоступен');
    }
  }

  async runAuthenticationTests() {
    console.log('🔐 ТЕСТЫ АУТЕНТИФИКАЦИИ (Оценка: 3)\n');
    
    // 1. Успешная регистрация
    try {
      const response = await axios.post(`${BASE_URL}/auth/register`, {
        email: 'testuser@example.com',
        password: 'password123',
        name: 'Test User'
      });
      
      if (response.status === 201 && response.data.success) {
        this.authTokens.user = response.data.data.token;
        this.ids.userId = response.data.data.user.id;
        this.recordTest('1. Успешная регистрация', true);
        console.log('   ✅ 1. Успешная регистрация');
      } else {
        this.recordTest('1. Успешная регистрация', false);
      }
    } catch (error) {
      this.recordTest('1. Успешная регистрация', false, error.message);
    }
    
    // 2. Регистрация с существующим email
    try {
      await axios.post(`${BASE_URL}/auth/register`, {
        email: 'testuser@example.com',
        password: 'anotherpassword',
        name: 'Another User'
      });
      this.recordTest('2. Регистрация с существующим email', false, 'Должна быть ошибка 409');
    } catch (error) {
      if (error.response?.status === 409) {
        this.recordTest('2. Регистрация с существующим email', true);
        console.log('   ✅ 2. Регистрация с существующим email (отклонена)');
      } else {
        this.recordTest('2. Регистрация с существующим email', false, `Ожидался статус 409, получен ${error.response?.status}`);
      }
    }
    
    // 3. Успешный вход
    try {
      const response = await axios.post(`${BASE_URL}/auth/login`, {
        email: 'testuser@example.com',
        password: 'password123'
      });
      
      if (response.status === 200 && response.data.success) {
        this.recordTest('3. Успешный вход', true);
        console.log('   ✅ 3. Успешный вход');
      } else {
        this.recordTest('3. Успешный вход', false);
      }
    } catch (error) {
      this.recordTest('3. Успешный вход', false, error.message);
    }
    
    // 4. Вход с неверными данными
    try {
      await axios.post(`${BASE_URL}/auth/login`, {
        email: 'testuser@example.com',
        password: 'wrongpassword'
      });
      this.recordTest('4. Вход с неверными данными', false, 'Должна быть ошибка 401');
    } catch (error) {
      if (error.response?.status === 401) {
        this.recordTest('4. Вход с неверными данными', true);
        console.log('   ✅ 4. Вход с неверными данными (отклонен)');
      } else {
        this.recordTest('4. Вход с неверными данными', false, `Ожидался статус 401, получен ${error.response?.status}`);
      }
    }
    
    // 5. Доступ к защищенному маршруту без токена
    try {
      await axios.get(`${BASE_URL}/users/me`);
      this.recordTest('5. Доступ без токена', false, 'Должна быть ошибка 401');
    } catch (error) {
      if (error.response?.status === 401) {
        this.recordTest('5. Доступ без токена', true);
        console.log('   ✅ 5. Доступ без токена (запрещен)');
      } else {
        this.recordTest('5. Доступ без токена', false, `Ожидался статус 401, получен ${error.response?.status}`);
      }
    }
    
    console.log('');
  }

  async runUserTests() {
    console.log('👤 ТЕСТЫ ПОЛЬЗОВАТЕЛЕЙ\n');
    
    // 6. Получение профиля с токеном
    try {
      const response = await axios.get(`${BASE_URL}/users/me`, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      
      if (response.status === 200 && response.data.success) {
        this.recordTest('6. Получение профиля с токеном', true);
        console.log('   ✅ 6. Получение профиля с токеном');
      } else {
        this.recordTest('6. Получение профиля с токеном', false);
      }
    } catch (error) {
      this.recordTest('6. Получение профиля с токеном', false, error.message);
    }
    
    // 7. Обновление профиля
    try {
      const response = await axios.put(`${BASE_URL}/users/me`, {
        name: 'Updated Test User',
        email: 'updateduser@example.com'
      }, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      
      if (response.status === 200 && response.data.success) {
        this.recordTest('7. Обновление профиля', true);
        console.log('   ✅ 7. Обновление профиля');
      } else {
        this.recordTest('7. Обновление профиля', false);
      }
    } catch (error) {
      this.recordTest('7. Обновление профиля', false, error.message);
    }
    
    console.log('');
  }

  async runAdminTests() {
    console.log('👑 АДМИНИСТРАТИВНЫЕ ТЕСТЫ\n');
    
    // 8. Вход как администратор
    try {
      const response = await axios.post(`${BASE_URL}/auth/login`, {
        email: 'admin@example.com',
        password: 'admin123'
      });
      
      if (response.status === 200 && response.data.success && response.data.data.user.roles.includes('admin')) {
        this.authTokens.admin = response.data.data.token;
        this.recordTest('8. Вход как администратор', true);
        console.log('   ✅ 8. Вход как администратор');
      } else {
        this.recordTest('8. Вход как администратор', false);
      }
    } catch (error) {
      this.recordTest('8. Вход как администратор', false, error.message);
    }
    
    // 9. Админ получает список пользователей
    try {
      const response = await axios.get(`${BASE_URL}/users?page=1&limit=10`, {
        headers: { Authorization: `Bearer ${this.authTokens.admin}` }
      });
      
      if (response.status === 200 && response.data.success && response.data.data.pagination) {
        this.recordTest('9. Админ получает список пользователей', true);
        console.log('   ✅ 9. Админ получает список пользователей');
      } else {
        this.recordTest('9. Админ получает список пользователей', false);
      }
    } catch (error) {
      this.recordTest('9. Админ получает список пользователей', false, error.message);
    }
    
    // 10. Обычный пользователь пытается получить список пользователей
    try {
      await axios.get(`${BASE_URL}/users`, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      this.recordTest('10. Обычный пользователь пытается получить список пользователей', false, 'Должна быть ошибка 403');
    } catch (error) {
      if (error.response?.status === 403) {
        this.recordTest('10. Обычный пользователь пытается получить список пользователей', true);
        console.log('   ✅ 10. Обычный пользователь пытается получить список пользователей (запрещено)');
      } else {
        this.recordTest('10. Обычный пользователь пытается получить список пользователей', false, `Ожидался статус 403, получен ${error.response?.status}`);
      }
    }
    
    console.log('');
  }

  async runOrderTests() {
    console.log('📦 ТЕСТЫ ЗАКАЗОВ (Оценка: 4)\n');
    
    // 11. Создание заказа
    try {
      const response = await axios.post(`${BASE_URL}/orders`, {
        items: [
          {
            productId: "prod_001",
            name: "Ноутбук",
            quantity: 1,
            price: 999.99
          },
          {
            productId: "prod_002",
            name: "Мышь",
            quantity: 2,
            price: 25.50
          }
        ],
        totalAmount: 1050.99
      }, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      
      if (response.status === 201 && response.data.success) {
        this.ids.orderId = response.data.data.order.id;
        this.recordTest('11. Создание заказа', true);
        console.log('   ✅ 11. Создание заказа');
      } else {
        this.recordTest('11. Создание заказа', false);
      }
    } catch (error) {
      this.recordTest('11. Создание заказа', false, error.message);
    }
    
    // 12. Получение созданного заказа
    try {
      const response = await axios.get(`${BASE_URL}/orders/${this.ids.orderId}`, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      
      if (response.status === 200 && response.data.success) {
        this.recordTest('12. Получение созданного заказа', true);
        console.log('   ✅ 12. Получение созданного заказа');
      } else {
        this.recordTest('12. Получение созданного заказа', false);
      }
    } catch (error) {
      this.recordTest('12. Получение созданного заказа', false, error.message);
    }
    
    // 13. Получение списка заказов с пагинацией
    try {
      const response = await axios.get(`${BASE_URL}/orders?page=1&limit=5&sortBy=createdAt&sortOrder=desc`, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      
      if (response.status === 200 && response.data.success && response.data.data.pagination) {
        this.recordTest('13. Получение списка заказов с пагинацией', true);
        console.log('   ✅ 13. Получение списка заказов с пагинацией');
      } else {
        this.recordTest('13. Получение списка заказов с пагинацией', false);
      }
    } catch (error) {
      this.recordTest('13. Получение списка заказов с пагинацией', false, error.message);
    }
    
    console.log('');
  }

  async runAdvancedTests() {
    console.log('🎯 ПРОДВИНУТЫЕ ТЕСТЫ (Оценка: 5)\n');
    
    // 14. Создание второго пользователя
    try {
      const response = await axios.post(`${BASE_URL}/auth/register`, {
        email: 'otheruser@example.com',
        password: 'password123',
        name: 'Other User'
      });
      
      if (response.status === 201 && response.data.success) {
        this.authTokens.otherUser = response.data.data.token;
        this.ids.otherUserId = response.data.data.user.id;
        this.recordTest('14. Создание второго пользователя', true);
        console.log('   ✅ 14. Создание второго пользователя');
      } else {
        this.recordTest('14. Создание второго пользователя', false);
      }
    } catch (error) {
      this.recordTest('14. Создание второго пользователя', false, error.message);
    }
    
    // 15. Попытка доступа к чужому заказу
    try {
      await axios.get(`${BASE_URL}/orders/${this.ids.orderId}`, {
        headers: { Authorization: `Bearer ${this.authTokens.otherUser}` }
      });
      this.recordTest('15. Попытка доступа к чужому заказу', false, 'Должна быть ошибка 403');
    } catch (error) {
      if (error.response?.status === 403) {
        this.recordTest('15. Попытка доступа к чужому заказу', true);
        console.log('   ✅ 15. Попытка доступа к чужому заказу (запрещена)');
      } else {
        this.recordTest('15. Попытка доступа к чужому заказу', false, `Ожидался статус 403, получен ${error.response?.status}`);
      }
    }
    
    // 16. Отмена собственного заказа
    try {
      const response = await axios.delete(`${BASE_URL}/orders/${this.ids.orderId}`, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      
      if (response.status === 200 && response.data.success && response.data.data.order.status === 'cancelled') {
        this.recordTest('16. Отмена собственного заказа', true);
        console.log('   ✅ 16. Отмена собственного заказа');
      } else {
        this.recordTest('16. Отмена собственного заказа', false);
      }
    } catch (error) {
      this.recordTest('16. Отмена собственного заказа', false, error.message);
    }
    
    // 17. Попытка отменить уже отмененный заказ
    try {
      await axios.delete(`${BASE_URL}/orders/${this.ids.orderId}`, {
        headers: { Authorization: `Bearer ${this.authTokens.user}` }
      });
      this.recordTest('17. Попытка отменить уже отмененный заказ', false, 'Должна быть ошибка 400');
    } catch (error) {
      if (error.response?.status === 400) {
        this.recordTest('17. Попытка отменить уже отмененный заказ', true);
        console.log('   ✅ 17. Попытка отменить уже отмененный заказ (запрещена)');
      } else {
        this.recordTest('17. Попытка отменить уже отмененный заказ', false, `Ожидался статус 400, получен ${error.response?.status}`);
      }
    }
    
    // 18. Админ может получить любой заказ
    try {
      const response = await axios.get(`${BASE_URL}/orders/${this.ids.orderId}`, {
        headers: { Authorization: `Bearer ${this.authTokens.admin}` }
      });
      
      if (response.status === 200 && response.data.success) {
        this.recordTest('18. Админ может получить любой заказ', true);
        console.log('   ✅ 18. Админ может получить любой заказ');
      } else {
        this.recordTest('18. Админ может получить любой заказ', false);
      }
    } catch (error) {
      this.recordTest('18. Админ может получить любой заказ', false, error.message);
    }
    
    console.log('');
  }

  recordTest(name, passed, message = '') {
    const test = {
      name,
      passed,
      message
    };
    
    testResults.tests.push(test);
    
    if (passed) {
      testResults.passed++;
    } else {
      testResults.failed++;
    }
  }

  printSummary() {
    console.log('='.repeat(60));
    console.log('📊 ИТОГОВЫЙ ОТЧЕТ');
    console.log('='.repeat(60));
    
    console.log(`\n✅ Пройдено: ${testResults.passed}`);
    console.log(`❌ Провалено: ${testResults.failed}`);
    console.log(`📈 Всего тестов: ${testResults.tests.length}`);
    
    const successRate = (testResults.passed / testResults.tests.length * 100).toFixed(2);
    console.log(`🎯 Успешность: ${successRate}%`);
    
  
    
    console.log('\n📋 Детали тестов:');
    console.log('-'.repeat(60));
    
    testResults.tests.forEach((test, index) => {
      const status = test.passed ? '✅' : '❌';
      console.log(`${status} ${index + 1}. ${test.name}`);
      if (!test.passed && test.message) {
        console.log(`   💡 ${test.message}`);
      }
    });
    
   
  }
}

// Запуск тестов
if (require.main === module) {
  const runner = new TestRunner();
  runner.run().catch(console.error);
}

module.exports = TestRunner;